// src/app/api/private/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { verifySession } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAuthoritativeUserTier } from "../../_lib/userTier";
import type { UserTier } from "@/src/lib/credits";
import {
    peekUserCredit,
    consumeUserCredit,
} from "../../_lib/credits-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            let decoded: any;
            try {
                decoded = await verifySession(req);
            } catch (e: any) {
                return NextResponse.json(
                    { error: e?.message || "Unauthorized" },
                    { status: 401 }
                );
            }

            const body = (await req.json().catch(() => ({}))) as { url?: string };
            const { url } = body;

            if (!isHttpUrl(url)) {
                return NextResponse.json(
                    { error: "Invalid URL" },
                    { status: 400 }
                );
            }

            let tier: UserTier;
            try {
                tier = await getAuthoritativeUserTier(decoded.uid);
            } catch (e: any) {
                return NextResponse.json(
                    {
                        error:
                            e?.message ||
                            "Unable to determine subscription tier. Try again shortly.",
                    },
                    { status: 500 }
                );
            }

            // Hard gate: do not even hit Fly if out of previews
            try {
                const peek = await peekUserCredit(decoded.uid, tier, "preview");
                if (!peek.ok || (peek.remaining !== null && peek.remaining <= 0)) {
                    return NextResponse.json(
                        {
                            error: "Monthly preview limit reached for your plan.",
                            remaining: peek.remaining,
                        },
                        { status: 429 }
                    );
                }
            } catch {
                return NextResponse.json(
                    { error: "Unable to check credits. Try again shortly." },
                    { status: 503 }
                );
            }

            try {
                const r = await callBackend(req, {
                    path: "/generate-screenshots",
                    method: "POST",
                    body: { url },
                    timeoutMs: 60_000,
                    acceptOnTimeout: true,
                    userCtx: {
                        uid: decoded.uid,
                        email: decoded?.email || "",
                        tier,
                    },
                });

                // Normalize payload
                const payload =
                    r.json && Object.keys(r.json).length
                        ? r.json
                        : {
                            ok: true,
                            queued: r.status === 202 || r.status === 204,
                        };

                // Decide if this run actually "succeeded" in a way that should burn a credit.
                //
                // Conditions for success:
                //  - HTTP status is 2xx (r.upstream.ok === true)
                //  - payload.error is falsy
                //  - payload.ok is not explicitly false
                //  - if payload.totalPlanned exists, it must be > 0 (we actually captured something)
                const hasErrorFlag = Boolean((payload as any).error);
                const okField = (payload as any).ok;
                const totalPlanned =
                    typeof (payload as any).totalPlanned === "number"
                        ? (payload as any).totalPlanned
                        : null;

                const logicalOk =
                    r.upstream.ok &&
                    !hasErrorFlag &&
                    okField !== false &&
                    (totalPlanned === null || totalPlanned > 0);

                // Backend failed or produced no captures → no credit burn
                if (!logicalOk) {
                    const status =
                        r.status && r.status >= 400
                            ? r.status
                            : 502;

                    return NextResponse.json(
                        {
                            error:
                                (payload as any).error ||
                                (payload as any).message ||
                                "Backend error (no captures or failed run).",
                            ...(totalPlanned === 0
                                ? { reason: "no_captures" }
                                : {}),
                        },
                        {
                            status,
                            headers: {
                                "x-request-id": r.reqId,
                                "cache-control": "no-store",
                            },
                        }
                    );
                }

                // Heavy work succeeded → burn one credit
                try {
                    // NOTE: currently charging "snapshot" credits for this endpoint.
                    // If you want it to use "preview", change the third arg accordingly.
                    await consumeUserCredit(decoded.uid, tier, "snapshot");
                } catch {
                    // If this fails you effectively gave a free run; acceptable.
                }

                return NextResponse.json(payload, {
                    status: 200,
                    headers: {
                        "x-request-id": r.reqId,
                        "cache-control": "no-store",
                    },
                });
            } catch (e: any) {
                return NextResponse.json(
                    { error: e?.message || "Proxy failed" },
                    { status: 502 }
                );
            }
        },
        { methods: ["POST"] }
    );
}
