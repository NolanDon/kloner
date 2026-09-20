import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import {
    loadUrlScanAttemptsForDay,
    reportDayBounds,
    sendDailyUrlScanReportEmail,
} from "@/src/lib/urlScanReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
    const secret = (process.env.CRON_SECRET || "").trim();
    const header = req.headers.get("authorization") || "";
    return Boolean(secret && header === `Bearer ${secret}`);
}

export async function GET(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const requestedDate = req.nextUrl.searchParams.get("date") || "";
    const currentDay = reportDayBounds();
    const dateKey = requestedDate || new Date(currentDay.start.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const report = await loadUrlScanAttemptsForDay(dateKey);
    const counts = report.attempts.reduce(
        (out, item) => {
            const status = String(item.status || "failure");
            if (status === "success" || status === "failure" || status === "queued") out[status] += 1;
            return out;
        },
        { success: 0, failure: 0, queued: 0 },
    );

    const db = getAdminDb();
    const reportRef = db.collection("url_scan_daily_reports").doc(report.dateKey);
    const existing = await reportRef.get();
    const existingData = existing.exists ? existing.data() || {} : {};
    await reportRef.set({
        dateKey: report.dateKey,
        start: report.start,
        end: report.end,
        counts,
        total: report.attempts.length,
        updatedAt: new Date(),
        emailSentAt: existingData.emailSentAt || null,
        emailError: null,
    }, { merge: true });

    let emailSent = Boolean(existingData.emailSentAt);
    let emailError: string | null = null;
    if (!emailSent) {
        try {
            await sendDailyUrlScanReportEmail({ dateKey: report.dateKey, attempts: report.attempts });
            emailSent = true;
            await reportRef.set({ emailSentAt: new Date(), emailError: null }, { merge: true });
        } catch (error) {
            emailError = error instanceof Error ? error.message : String(error);
            await reportRef.set({ emailError: emailError.slice(0, 500) }, { merge: true });
        }
    }

    return NextResponse.json({
        ok: true,
        dateKey: report.dateKey,
        total: report.attempts.length,
        counts,
        emailSent,
        emailError,
    }, { headers: { "cache-control": "no-store" } });
}
