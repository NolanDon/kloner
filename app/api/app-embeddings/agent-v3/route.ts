import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asString = (value: unknown, max = 10_000) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, max) : "";
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const body = await authedReq.json().catch(() => ({} as Record<string, unknown>));
        const appId = asString(body.appId, 200);
        const query = asString(body.query ?? body.requestText, 10_000);
        if (!appId || !query) return NextResponse.json({ error: "Missing appId or query" }, { status: 400 });
        assertAppBuilderScope(authedReq, uid, appId);

        const result = await callBackend(authedReq, {
            path: "/app-embeddings/agent-v3",
            method: "POST",
            timeoutMs: 15_000,
            userCtx: { uid },
            body: {
                appId,
                query,
                requestText: query,
                currentPath: asString(body.currentPath, 500) || null,
                selectedFiles: Array.isArray(body.selectedFiles) ? body.selectedFiles.slice(0, 20) : [],
                repairContext: body.repairContext && typeof body.repairContext === "object" ? body.repairContext : null,
            },
        });
        return NextResponse.json(result.json, { status: result.status });
    });
}
