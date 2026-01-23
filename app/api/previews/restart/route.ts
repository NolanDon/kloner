import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeCode(input: any): string | null {
    const raw = typeof input === "string" ? input.trim() : "";
    if (!raw) return null;
    // Preview codes are typically UUIDs; allow UUID-ish tokens.
    if (!/^[a-z0-9-]{8,}$/i.test(raw)) return null;
    return raw;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const appId = typeof body?.appId === "string" ? body.appId.trim() : "";
            const code = sanitizeCode(body?.code);

            if (!appId || !code) {
                return NextResponse.json({ ok: false, error: "Missing appId or code" }, { status: 400 });
            }

            assertAppBuilderScope(authedReq, uid, appId);

            console.info("[previews/restart]", { appId, code: "(provided)", uid });

            let result: Awaited<ReturnType<typeof callBackend>>;
            try {
                result = await callBackend(authedReq, {
                    path: `/preview/${code}/restart`,
                    method: "POST",
                    timeoutMs: 25_000,
                    userCtx: { uid },
                    body: { appId },
                });
            } catch (err: any) {
                const msg = String(err?.message || "Backend call failed");
                console.error("[previews/restart] callBackend threw", { msg });
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
                    { ok: false, error: "Failed to reach preview service.", code: "PREVIEW_SERVICE_UNREACHABLE" },
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

            if (process.env.NODE_ENV !== "production" && result.status >= 400) {
                const base = result.json;
                const debug = { status: result.status, reqId: result.reqId, url: result.url };
                if (base && typeof base === "object" && !Array.isArray(base)) {
                    return NextResponse.json({ ...(base as any), __debug: debug }, { status: result.status });
                }
                return NextResponse.json({ ok: result.upstream.ok, data: base, __debug: debug }, { status: result.status });
            }

            return NextResponse.json(result.json, { status: result.status });
        },
        { csrf: true, methods: ["POST"] },
    );
}
