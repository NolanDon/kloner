import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { captureCriticalEvent } from "@/lib/observability";
import type { ObservabilitySeverity } from "@/lib/observability";

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

function cleanSeverity(value: unknown): ObservabilitySeverity {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === "critical" || raw === "error" || raw === "warning" || raw === "info") return raw;
    return "critical";
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const requestUserAgent = cleanText(authedReq.headers.get("user-agent"), 500);
            const origin = cleanText(authedReq.headers.get("origin"), 300);
            const referer = cleanText(authedReq.headers.get("referer"), 300);
            const clientIp =
                cleanText(authedReq.headers.get("x-forwarded-for"), 300) ||
                cleanText(authedReq.headers.get("x-real-ip"), 300) ||
                cleanText(authedReq.headers.get("fly-client-ip"), 300) ||
                cleanText(authedReq.headers.get("cf-connecting-ip"), 300) ||
                cleanText(authedReq.headers.get("x-vercel-forwarded-for"), 300);

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
            const severity = cleanSeverity(body?.severity);
            const route = cleanText(body?.route, 300) || "/dashboard/view";
            const service = cleanText(body?.service, 200) || "webcontainer-runner";
            const message =
                cleanText(body?.message, 1000) ||
                "Preview exceeded timeout while starting in frontend polling";
            const previewUrl = cleanText(body?.previewUrl, 1000);
            const browser = cleanText(body?.browser, 120);
            const payloadUserAgent = cleanText(body?.userAgent, 500);
            const reason = cleanText(body?.reason, 200);
            const machineId = cleanText(body?.machineId, 120);
            const ageMs = cleanNumber(body?.ageMs);
            const elapsedMs = cleanNumber(body?.elapsedMs);
            const statusCode = cleanNumber(body?.statusCode) || ((severity === "info" || severity === "warning") ? 200 : 504);
            const tags = cleanTags(body?.tags) || ["preview", "timeout", "frontend"];
            const requestId = cleanText(body?.requestId, 200);
            const jobId = cleanText(body?.jobId, 200);
            const alertKey = cleanText(body?.alertKey, 300);
            const deduped = body?.deduped === true;

            const backend = body?.backend && typeof body.backend === "object" ? body.backend : {};
            const backendDebug = backend?.debug && typeof backend.debug === "object" ? backend.debug : {};

            const backendStatus = cleanText((backend as any)?.status, 80);
            const backendUiStage = cleanText((backend as any)?.uiStage, 120);
            const timeoutReason = cleanText((backendDebug as any)?.timeoutReason, 120);
            const backendMachineId = cleanText((backendDebug as any)?.machine?.id, 120);
            const machineState = cleanText((backendDebug as any)?.machine?.state, 120);
            const machineRestartCount = cleanNumber((backendDebug as any)?.machine?.restartCount);
            const compileSummary = cleanText((backendDebug as any)?.compile?.summary, 300);
            const rootfsIoCorruption =
                typeof (backendDebug as any)?.storage?.rootfsIoCorruption === "boolean"
                    ? (backendDebug as any).storage.rootfsIoCorruption
                    : undefined;

            const requestContext = {
                callerType: "frontend-browser",
                userAgent: requestUserAgent || undefined,
                origin: origin || undefined,
                referer: referer || undefined,
                clientIp: clientIp || undefined,
                hasSession: true,
                hasBearer: Boolean(authedReq.headers.get("authorization")),
            };

            const enrichedMessage = [
                message,
                browser ? `browser=${browser}` : "",
                reason ? `reason=${reason}` : "",
                payloadUserAgent ? `ua=${payloadUserAgent}` : "",
            ]
                .filter(Boolean)
                .join(" | ");

            await captureCriticalEvent({
                source: "frontend",
                severity,
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
                    userAgent: payloadUserAgent || undefined,
                    ageMs: typeof ageMs === "number" ? ageMs : undefined,
                    elapsedMs: typeof elapsedMs === "number" ? elapsedMs : undefined,
                    requestId: requestId || undefined,
                    jobId: jobId || undefined,
                    requestContext,
                    alertKey: alertKey || undefined,
                    deduped,
                    backend: {
                        status: backendStatus || undefined,
                        uiStage: backendUiStage || undefined,
                        debug: {
                            timeoutReason: timeoutReason || undefined,
                            machine: {
                                id: backendMachineId || machineId || undefined,
                                state: machineState || undefined,
                                restartCount: typeof machineRestartCount === "number" ? machineRestartCount : undefined,
                            },
                            compile: {
                                summary: compileSummary || undefined,
                            },
                            storage: {
                                rootfsIoCorruption,
                            },
                        },
                    },
                },
            });

            return NextResponse.json({ ok: true });
        },
        { csrf: true, methods: ["POST"] },
    );
}
