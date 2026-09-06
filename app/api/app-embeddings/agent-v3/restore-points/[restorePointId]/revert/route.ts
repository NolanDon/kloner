import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ restorePointId?: string }> }) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const body = await authedReq.json().catch(() => ({} as Record<string, unknown>));
        const params = await context.params;
        const appId = typeof body.appId === "string" ? body.appId.trim() : "";
        const restorePointId = String(params.restorePointId || body.restorePointId || "").trim();
        if (!appId || !restorePointId) return NextResponse.json({ error: "Missing appId or restorePointId" }, { status: 400 });
        assertAppBuilderScope(authedReq, uid, appId);

        const result = await callBackend(authedReq, {
            path: `/app-embeddings/agent-v3/restore-points/${encodeURIComponent(restorePointId)}/revert`,
            method: "POST",
            timeoutMs: 180_000,
            userCtx: { uid },
            body: { appId, restorePointId },
        });
        return NextResponse.json(result.json, { status: result.status });
    });
}
