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

                // Backend failed → no credit burn
                if (!r.upstream.ok) {
                    return NextResponse.json(
                        { error: r.json?.error || "Backend error" },
                        {
                            status: r.status,
                            headers: {
                                "x-request-id": r.reqId,
                                "cache-control": "no-store",
                            },
                        }
                    );
                }

                // Heavy work succeeded → burn one preview credit
                try {
                    await consumeUserCredit(decoded.uid, tier, "snapshot");
                } catch {
                    // If this fails you effectively gave a free run; fine for now.
                }

                const payload =
                    r.json && Object.keys(r.json).length
                        ? r.json
                        : {
                            ok: true,
                            queued: r.status === 202 || r.status === 204,
                        };

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
