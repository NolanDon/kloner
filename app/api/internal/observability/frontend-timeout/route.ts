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
            const message =
                cleanText(body?.message, 1000) ||
                "Preview exceeded timeout while starting in frontend polling";
            const previewUrl = cleanText(body?.previewUrl, 1000);
            const ageMs = cleanNumber(body?.ageMs);

            await captureCriticalEvent({
                source: "frontend",
                severity: "critical",
                statusCode: 504,
                route: "/dashboard/view",
                method: "POST",
                action: "preview_timeout_12min",
                userId: uid,
                message,
                service: "webcontainer-runner",
                tags: ["preview", "timeout", "frontend"],
                url: previewUrl || undefined,
                extra: {
                    appId: appId || undefined,
                    code: code || undefined,
                    status,
                    ageMs: typeof ageMs === "number" ? ageMs : undefined,
                },
            });

            return NextResponse.json({ ok: true });
        },
        { csrf: true, methods: ["POST"] },
    );
}
