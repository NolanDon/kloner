import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import type { UserTier } from "@/src/lib/credits";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { verifySession } from "../_lib/auth";
import { consumeUserCredit } from "../_lib/credits-server";
import { getAuthoritativeUserTier } from "../_lib/userTier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type Body = {
    renderId?: string;
    controllerVersion?: string; // optional forward, if you care
};

function isNonEmptyString(s: unknown): s is string {
    return typeof s === "string" && s.trim().length > 0;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            let decoded: any;
            try {
                decoded = await verifySession(req); // { uid, email, claims?: { userTier? } }
            } catch (e: any) {
                return NextResponse.json(
                    { error: e?.message || "Unauthorized" },
                    { status: 401 }
                );
            }

            // Authoritative tier (keeps behaviour consistent with preview route)
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

            const json = (await req.json().catch(() => ({}))) as Body;
            const renderId = isNonEmptyString(json.renderId)
                ? json.renderId.trim()
                : "";

            if (!renderId) {
                return NextResponse.json(
                    { error: "Missing renderId" },
                    { status: 400 }
                );
            }

            const controllerVersion = isNonEmptyString(json.controllerVersion)
                ? json.controllerVersion.trim()
                : undefined;

            try {
                const r = await callBackend(req, {
                    path: "/preview-render/seo-meta",
                    method: "POST",
                    body: {
                        renderId,
                        controllerVersion, // harmless pass-through; backend can ignore
                    },
                    timeoutMs: 120_000,
                    acceptOnTimeout: false,
                    userCtx: {
                        uid: decoded.uid,
                        email: decoded?.email || "",
                        tier,
                    },
                });

                const okJson =
                    r.json && Object.keys(r.json).length ? r.json : { ok: true };
                const status = r.upstream.ok ? 200 : r.status;

                // If you want SEO meta to burn the same "preview" credit, keep this.
                // If you prefer it to be free or a separate credit type, change/remove.
                if (r.upstream.ok && status === 200) {
                    try {
                        await consumeUserCredit(decoded.uid, tier, "preview");
                    } catch (err: any) {
                        console.warn("consumeUserCredit failed (seo-meta)", {
                            uid: decoded.uid,
                            err: err?.message || String(err),
                        });
                        // Do not fail the request just because credit write failed.
                    }
                }

                return NextResponse.json(
                    r.upstream.ok
                        ? okJson
                        : {
                            error: r.json?.error || "Backend error (seo-meta)",
                        },
                    {
                        status,
                        headers: {
                            "x-request-id": r.reqId,
                            "cache-control": "no-store",
                        },
                    }
                );
            } catch (e: any) {
                return NextResponse.json(
                    { error: e?.message || "Proxy failed (seo-meta)" },
                    { status: 502 }
                );
            }
        },
        { methods: ["POST"] }
    );
}
