// src/app/api/preview/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { verifySession } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAuthoritativeUserTier } from "../../_lib/userTier";
import { peekUserCredit, consumeUserCredit } from "../../_lib/credits-server";
import type { UserTier } from "@/src/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type Body = {
    key?: string;
    keys?: string[];
    storageKey?: string;
    storageKeys?: string[];
    screenshotKey?: string;
    screenshotKeys?: string[];
    nameHint?: string;
    url?: string; // optional: trigger generation if no keys
    controllerVersion?: string; // optional: forwarded
    // NEW: passed through to backend so it can reuse render doc on retry
    retry?: boolean | string;
    renderId?: string;
    // optional from client; if absent we infer it
    urlHash?: string;
};

function isNonEmptyString(s: unknown): s is string {
    return typeof s === "string" && s.trim().length > 0;
}
function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try {
        const u = new URL(s);
        return u.protocol === "http:" || "https:" === u.protocol;
    } catch {
        return false;
    }
}
function normUrl(s: string): string {
    try {
        const u = new URL(s);
        u.hash = "";
        return u.toString();
    } catch {
        return s.trim();
    }
}
function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36);
}
/** kloner-screenshots/<uid>/url-scans/<urlHash>/<urlHash>-<ts>.jpeg */
function extractHashFromKey(key?: string | null): string | null {
    if (!key) return null;
    const parts = key.split("/");
    const i = parts.indexOf("url-scans");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    const file = parts[parts.length - 1] || "";
    const maybe = file.split("-")[0];
    return maybe && maybe.length >= 6 ? maybe : null;
}
/** Ensure the storage key lives under this user's namespace */
function keyBelongsToUser(key: string, uid: string) {
    return key.startsWith(`kloner-screenshots/${uid}/`);
}

function jsonNoStatusAlert(body: any, init: { status: number; headers?: Record<string, string> }) {
    return NextResponse.json(body, {
        ...init,
        headers: {
            ...(init.headers || {}),
            "x-observability-skip-status-alert": "1",
        },
    });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            let decoded: any;
            try {
                decoded = await verifySession(req); // { uid, email, claims?: { userTier? } }
            } catch (e: any) {
                return jsonNoStatusAlert(
                    { error: e?.message || "Unauthorized" },
                    { status: 401 }
                );
            }

            // Authoritative tier from Stripe/Firestore so credits + limits are in sync
            let tier: UserTier;
            try {
                tier = await getAuthoritativeUserTier(decoded.uid);
            } catch (e: any) {
                return jsonNoStatusAlert(
                    {
                        error:
                            e?.message ||
                            "Unable to determine subscription tier. Try again shortly.",
                    },
                    { status: 500 }
                );
            }

            if (tier === "free") {
                return jsonNoStatusAlert(
                    {
                        error: "Upgrade to Pro or Agency to create websites or apps from the dashboard.",
                        code: "APP_GENERATION_TIER_BLOCKED",
                        reason: "app_generation_tier_blocked",
                        requiredTiers: ["trialing", "pro", "agency"],
                    },
                    { status: 403 }
                );
            }


            const json = (await req.json().catch(() => ({}))) as Body;

            // NEW: normalize retry + renderId from client
            const isRetry =
                json.retry === true || json.retry === "true";
            const renderId =
                typeof json.renderId === "string" && json.renderId.trim().length
                    ? json.renderId.trim()
                    : undefined;

            // Normalize inputs
            const controllerVersion = isNonEmptyString(json.controllerVersion)
                ? json.controllerVersion.trim()
                : undefined;
            const incomingUrl = isHttpUrl(json.url) ? normUrl(json.url!) : undefined;
            const incomingNameHint = isNonEmptyString(json.nameHint)
                ? json.nameHint!.trim()
                : undefined;

            let key = isNonEmptyString(json.key) ? json.key.trim() : undefined;
            let keys = Array.isArray(json.keys)
                ? json.keys.filter(isNonEmptyString).map((k) => k.trim())
                : undefined;

            const storageKey = isNonEmptyString(json.storageKey)
                ? json.storageKey.trim()
                : undefined;
            const storageKeys = Array.isArray(json.storageKeys)
                ? json.storageKeys.filter(isNonEmptyString).map((k) => k.trim())
                : undefined;
            const screenshotKey = isNonEmptyString(json.screenshotKey)
                ? json.screenshotKey.trim()
                : undefined;
            const screenshotKeys = Array.isArray(json.screenshotKeys)
                ? json.screenshotKeys.filter(isNonEmptyString).map((k) => k.trim())
                : undefined;

            key = key || storageKey || screenshotKey;
            keys = keys || storageKeys || screenshotKeys;

            const outKeys = (keys && keys.length ? keys : key ? [key] : [])
                .map((k) => k.trim())
                .filter(Boolean)
                .slice(0, 25); // hard cap to avoid abuse

            if (!outKeys.length) {
                return jsonNoStatusAlert(
                    {
                        error: "Missing keys",
                    },
                    { status: 400 }
                );
            }
            // HARD GATE: do not render if out of preview credits
            try {
                const peek = await peekUserCredit(decoded.uid, tier, "preview");

                if (!peek.ok || (peek.remaining !== null && peek.remaining < 1)) {
                    return jsonNoStatusAlert(
                        {
                            error: "Monthly preview limit reached for your plan.",
                            code: "PREVIEW_CREDITS_EXHAUSTED",
                            reason: "preview_credits_exhausted",
                            remaining: peek.remaining,
                            kind: "preview",
                        },
                        { status: 429 }
                    );
                }
            } catch (e: any) {
                return jsonNoStatusAlert(
                    {
                        error:
                            e?.message ||
                            "Unable to check preview credits. Try again shortly.",
                    },
                    { status: 503 }
                );
            }

            // Namespace check: keys must belong to this user
            for (const k of outKeys) {
                if (!keyBelongsToUser(k, decoded.uid)) {
                    return jsonNoStatusAlert(
                        { error: "Forbidden key namespace" },
                        { status: 403 }
                    );
                }
            }

            // Infer urlHash, but let client-provided value win if present
            const inferredHash = incomingUrl
                ? hash64(incomingUrl)
                : extractHashFromKey(outKeys[0]) || undefined;

            const urlHash = isNonEmptyString(json.urlHash)
                ? json.urlHash.trim()
                : inferredHash;

            const nameHint =
                incomingNameHint ||
                (incomingUrl ? new URL(incomingUrl).hostname : undefined);

            try {
                const firstKey = outKeys[0];
                const r = await callBackend(req, {
                    path: "/preview-render",
                    method: "POST",
                    body: {
                        url: incomingUrl,
                        urlHint: incomingUrl,
                        urlHash,
                        nameHint: nameHint ?? null,
                        key: firstKey,
                        keys: outKeys.length ? outKeys : undefined,
                        storageKey: firstKey,
                        storageKeys: outKeys.length ? outKeys : undefined,
                        screenshotKey: firstKey,
                        screenshotKeys: outKeys.length ? outKeys : undefined,
                        controllerVersion, // transparent forward if provided
                        // NEW: forward retry + renderId so backend can reuse doc
                        retry: isRetry || undefined,
                        renderId: renderId || undefined,
                    },
                    timeoutMs: 240_000,
                    acceptOnTimeout: true,
                    userCtx: {
                        uid: decoded.uid,
                        email: decoded?.email || "",
                        tier,
                    },
                });

                const okJson =
                    r.json && Object.keys(r.json).length ? r.json : { ok: true };

                const status = r.upstream.ok
                    ? 200
                    : r.status === 504 || r.status === 524
                        ? 202
                        : r.status;

                const shouldChargePreview =
                    r.upstream.ok &&
                    status === 200 &&
                    okJson &&
                    okJson.ok !== false &&
                    typeof okJson.renderId === "string" &&
                    (!("status" in okJson) || okJson.status === "ready") &&
                    (typeof okJson.progress !== "number" ||
                        okJson.progress >= 90);

                if (shouldChargePreview) {
                    try {
                        await consumeUserCredit(decoded.uid, tier, "preview");
                    } catch (err: any) {
                        console.warn("consumeUserCredit failed (preview)", {
                            uid: decoded.uid,
                            err: err?.message || String(err),
                        });
                    }
                }

                return NextResponse.json(
                    status === 202
                        ? { ...okJson, queued: true }
                        : r.upstream.ok
                            ? okJson
                            : {
                                error:
                                    r.json?.error ||
                                    "Backend error (render)",
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
                return jsonNoStatusAlert(
                    { error: e?.message || "Proxy failed (render)" },
                    { status: 502 }
                );
            }
        },
        { methods: ["POST"] }
    );
}
