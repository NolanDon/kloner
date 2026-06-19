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

function cleanSeverity(value: unknown): "critical" | "error" | "warning" | "info" {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === "critical" || raw === "warning" || raw === "info") return raw;
    return "error";
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
            const appName = cleanText(body?.appName, 200);
            const code = cleanText(body?.code, 120);
            const statusCode = cleanNumber(body?.statusCode);
            const route = cleanText(body?.route, 200) || "/api/app-builder/[appId]/deploy";
            const method = cleanText(body?.method, 20) || "POST";
            const message = cleanText(body?.message, 1000) || "Deploy wizard failure";
            const errorName = cleanText(body?.errorName, 200);
            const stack = cleanText(body?.stack, 10000);
            const url = cleanText(body?.url, 1000);
            const service = cleanText(body?.service, 200) || "dashboard-deploy-wizard";
            const phase = cleanText(body?.phase, 120);
            const attempt = cleanNumber(body?.attempt);
            const vercelProjectId = cleanText(body?.vercelProjectId, 200);
            const vercelProjectName = cleanText(body?.vercelProjectName, 200);
            const vercelTeamId = cleanText(body?.vercelTeamId, 200);
            const deployBodyBytes = cleanNumber(body?.deployBodyBytes);
            const bodyLimitBytes = cleanNumber(body?.bodyLimitBytes);
            const extra = body?.extra && typeof body.extra === "object" ? body.extra : {};

            const severity = cleanSeverity(body?.severity);

            const result = await captureCriticalEvent({
                source: "internal",
                severity,
                alwaysNotifySlack: true,
                statusCode,
                route,
                method,
                action: "deploy_wizard_error",
                userId: uid,
                message,
                errorName: errorName || code || undefined,
                stack: stack || undefined,
                url: url || undefined,
                service,
                tags: cleanTags(body?.tags) || ["deploy", "wizard"],
                extra: {
                    appId: appId || undefined,
                    appName: appName || undefined,
                    code: code || undefined,
                    phase: phase || undefined,
                    attempt: typeof attempt === "number" ? attempt : undefined,
                    vercelProjectId: vercelProjectId || undefined,
                    vercelProjectName: vercelProjectName || undefined,
                    vercelTeamId: vercelTeamId || undefined,
                    deployBodyBytes: typeof deployBodyBytes === "number" ? deployBodyBytes : undefined,
                    bodyLimitBytes: typeof bodyLimitBytes === "number" ? bodyLimitBytes : undefined,
                    ...(extra as Record<string, unknown>),
                },
            });

            return NextResponse.json({ ok: true, delivered: result.delivered });
        },
        { csrf: true, methods: ["POST"] },
    );
}
