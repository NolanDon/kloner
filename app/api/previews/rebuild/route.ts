import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const appId = typeof body?.appId === "string" ? body.appId.trim() : "";
            const code = typeof body?.code === "string" ? body.code.trim() : "";
            const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

            if (!appId) {
                return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
            }

            assertAppBuilderScope(authedReq, uid, appId);

            console.info("[previews/rebuild]", {
                appId,
                code: code ? "(provided)" : "(omitted)",
                uid,
                reason: reason || "(none)",
            });

            let result: Awaited<ReturnType<typeof callBackend>>;
            try {
                result = await callBackend(authedReq, {
                    path: "/webcontainer/rebuild",
                    method: "POST",
                    timeoutMs: 60_000,
                    userCtx: { uid },
                    body: { appId, ...(code ? { code } : {}), ...(reason ? { reason } : {}) },
                });
            } catch (err: any) {
                const msg = String(err?.message || "Backend call failed");
                console.error("[previews/rebuild] callBackend threw", { msg });
                if (msg.includes("INTERNAL_API_KEY not set")) {
                    return NextResponse.json(
                        {
                            ok: false,
                            error:
                                "Server is missing INTERNAL_API_KEY. Set it in .env.local and restart the dev server.",
                            code: "MISSING_INTERNAL_API_KEY",
                        },
                        { status: 500 },
                    );
                }
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Failed to reach preview service.",
                        code: "PREVIEW_SERVICE_UNREACHABLE",
                    },
                    { status: 502 },
                );
            }

            if (result.status === 401 || result.status === 403) {
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            "Preview service authorization failed. This usually means INTERNAL_API_KEY on this server doesn’t match what the hub expects.",
                        code: "PREVIEW_SERVICE_AUTH",
                        ...(process.env.NODE_ENV !== "production"
                            ? { upstream: { status: result.status, reqId: result.reqId, url: result.url } }
                            : {}),
                    },
                    { status: 502 },
                );
            }

            return NextResponse.json(result.json, { status: result.status });
        },
        { csrf: true, methods: ["POST"] },
    );
}
