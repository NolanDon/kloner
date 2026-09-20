import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { loadUrlScanAttemptsForDay, reportDayBounds } from "@/src/lib/urlScanReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function iso(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof (value as any)?.toDate === "function") return (value as any).toDate().toISOString();
    return null;
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const user = await admin.auth().getUser(uid);
        if (user.customClaims?.admin !== true) {
            return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
        }

        const requestedDate = req.nextUrl.searchParams.get("date") || "";
        const fallbackDate = new Date(reportDayBounds().start.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const report = await loadUrlScanAttemptsForDay(requestedDate || fallbackDate);
        const saved = await getAdminDb().collection("url_scan_daily_reports").doc(report.dateKey).get();
        const data = saved.exists ? saved.data() || {} : {};
        const attempts: Array<Record<string, unknown> & { id: string; scannedAt: string | null }> = report.attempts.map((item) => ({
            ...item,
            scannedAt: iso(item.scannedAt),
        }));

        return NextResponse.json({
            ok: true,
            dateKey: report.dateKey,
            start: report.start.toISOString(),
            end: report.end.toISOString(),
            counts: data.counts || {
                success: attempts.filter((item) => item.status === "success").length,
                failure: attempts.filter((item) => item.status === "failure").length,
                queued: attempts.filter((item) => item.status === "queued").length,
            },
            emailSentAt: iso(data.emailSentAt),
            emailError: data.emailError || null,
            attempts,
        }, { headers: { "cache-control": "no-store" } });
    });
}
