import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../../../_lib/route-guard";
import { callBackend } from "@/src/lib/callBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown, max = 10_000): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    return text.length <= max ? text : text.slice(0, max);
}

export async function GET(req: NextRequest, context: { params: Promise<{ jobId?: string }> }) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const params = await context.params;
            const jobId = asString(params?.jobId, 200);
            if (!jobId) {
                return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
            }

            const result = await callBackend(authedReq, {
                path: `/app-embeddings/jobs/${encodeURIComponent(jobId)}`,
                method: "GET",
                timeoutMs: 15_000,
                userCtx: { uid },
            });

            return NextResponse.json(result.json, { status: result.status });
        },
        { methods: ["GET"] },
    );
}