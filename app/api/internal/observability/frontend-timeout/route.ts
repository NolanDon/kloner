import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, max = 500): string {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function cleanNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function cleanTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const tags = value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20);
    return tags.length ? tags : undefined;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            let body: any = {};
            try {
                body = await authedReq.json();
            } catch {
                body = {};
            }

            const appId = cleanText(body?.appId, 200);
            const code = cleanText(body?.code, 200);
            const status = cleanText(body?.status, 80) || "unknown";
            const action = cleanText(body?.action, 120) || "preview_timeout_12min";
            const route = cleanText(body?.route, 300) || "/dashboard/view";
            const service = cleanText(body?.service, 200) || "webcontainer-runner";
            const message =
                cleanText(body?.message, 1000) ||
                "Preview exceeded timeout while starting in frontend polling";
            const previewUrl = cleanText(body?.previewUrl, 1000);
            const browser = cleanText(body?.browser, 120);
            const userAgent = cleanText(body?.userAgent, 500);
            const reason = cleanText(body?.reason, 200);
            const ageMs = cleanNumber(body?.ageMs);
            const statusCode = cleanNumber(body?.statusCode) || 504;
            const tags = cleanTags(body?.tags) || ["preview", "timeout", "frontend"];

            const enrichedMessage = [
                message,
                browser ? `browser=${browser}` : "",
                reason ? `reason=${reason}` : "",
                userAgent ? `ua=${userAgent}` : "",
            ]
                .filter(Boolean)
                .join(" | ");

            await captureCriticalEvent({
                source: "frontend",
                severity: "critical",
                statusCode,
                route,
                method: "POST",
                action,
                userId: uid,
                message: enrichedMessage,
                service,
                tags,
                url: previewUrl || undefined,
                extra: {
                    appId: appId || undefined,
                    code: code || undefined,
                    status,
                    browser: browser || undefined,
                    reason: reason || undefined,
                    userAgent: userAgent || undefined,
                    ageMs: typeof ageMs === "number" ? ageMs : undefined,
                },
            });

            return NextResponse.json({ ok: true });
        },
        { csrf: true, methods: ["POST"] },
    );
}
