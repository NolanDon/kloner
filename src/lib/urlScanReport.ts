import "server-only";

import { Resend } from "resend";
import { getAdminDb } from "@/app/api/_lib/auth";

export type UrlScanAttemptStatus = "success" | "failure" | "queued";

export type UrlScanAttempt = {
    uid: string;
    tier?: string | null;
    url: string;
    status: UrlScanAttemptStatus;
    scannedAt?: Date;
    httpStatus?: number | null;
    backendCode?: string | null;
    backendRequestId?: string | null;
    backendSource?: string | null;
    rawError?: string | null;
    rawResponse?: string | null;
    totalPlanned?: number | null;
    requestId?: string | null;
};

const MAX_FIELD = 6000;

function clipped(value: unknown, max = MAX_FIELD): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
}

function safeUrl(value: string): string {
    try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        for (const key of ["token", "access_token", "auth", "api_key", "apikey", "key", "signature"]) {
            if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
        }
        return url.toString().slice(0, 2000);
    } catch {
        return value.slice(0, 2000);
    }
}

export async function recordUrlScanAttempt(attempt: UrlScanAttempt): Promise<void> {
    const db = getAdminDb();
    await db.collection("url_scan_attempts").add({
        uid: clipped(attempt.uid, 160),
        tier: clipped(attempt.tier, 80),
        url: safeUrl(attempt.url),
        status: attempt.status,
        scannedAt: attempt.scannedAt || new Date(),
        httpStatus: typeof attempt.httpStatus === "number" ? attempt.httpStatus : null,
        backendCode: clipped(attempt.backendCode, 160),
        backendRequestId: clipped(attempt.backendRequestId, 200),
        backendSource: clipped(attempt.backendSource, 160),
        rawError: clipped(attempt.rawError),
        rawResponse: clipped(attempt.rawResponse),
        totalPlanned: typeof attempt.totalPlanned === "number" ? attempt.totalPlanned : null,
        requestId: clipped(attempt.requestId, 200),
    });
}

export function reportDayBounds(dateKey?: string): { dateKey: string; start: Date; end: Date } {
    const base = dateKey ? new Date(`${dateKey}T00:00:00.000Z`) : new Date();
    const valid = !Number.isNaN(base.getTime());
    const start = valid ? new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())) : new Date(0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { dateKey: start.toISOString().slice(0, 10), start, end };
}

export async function loadUrlScanAttemptsForDay(dateKey?: string): Promise<{
    dateKey: string;
    start: Date;
    end: Date;
    attempts: Array<Record<string, unknown> & { id: string }>;
}> {
    const bounds = reportDayBounds(dateKey);
    const snap = await getAdminDb()
        .collection("url_scan_attempts")
        .where("scannedAt", ">=", bounds.start)
        .where("scannedAt", "<", bounds.end)
        .get();

    const attempts: Array<Record<string, unknown> & { id: string }> = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
    }));
    attempts.sort((a, b) => String(a.scannedAt || "").localeCompare(String(b.scannedAt || "")));
    return { ...bounds, attempts };
}

export async function sendDailyUrlScanReportEmail(args: {
    dateKey: string;
    attempts: Array<Record<string, unknown> & { id: string }>;
}): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY env not set");

    const counts = args.attempts.reduce(
        (out, item) => {
            const status = String(item.status || "failure") as UrlScanAttemptStatus;
            if (status === "success" || status === "queued" || status === "failure") out[status] += 1;
            return out;
        },
        { success: 0, failure: 0, queued: 0 },
    );

    const lines = args.attempts.map((item, index) => [
        `${index + 1}. ${String(item.status || "failure").toUpperCase()} ${String(item.url || "")}`,
        `   uid=${String(item.uid || "unknown")} tier=${String(item.tier || "unknown")} http=${String(item.httpStatus || "n/a")}`,
        `   code=${String(item.backendCode || "n/a")} request=${String(item.backendRequestId || item.requestId || "n/a")}`,
        `   error=${String(item.rawError || "none")}`,
    ].join("\n"));

    const text = [
        `Kloner daily URL scan report — ${args.dateKey} UTC`,
        `Total: ${args.attempts.length} | Successful: ${counts.success} | Failed: ${counts.failure} | Queued: ${counts.queued}`,
        "",
        ...(lines.length ? lines : ["No URL scans recorded."]),
    ].join("\n");

    await new Resend(apiKey).emails.send({
        from: process.env.ALERT_EMAIL_FROM || "support@kloner.app",
        to: process.env.SUPPORT_TO || "support@kloner.app",
        subject: `Kloner URL scan report · ${args.dateKey} · ${args.attempts.length} scans`,
        text,
    });
}
