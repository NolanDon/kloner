// src/app/api/preview/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { verifySession } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type Body = {
    key?: string;
    keys?: string[];
    nameHint?: string;
    url?: string;                // optional: trigger generation if no keys
    controllerVersion?: string;  // optional: forwarded
};

function isNonEmptyString(s: unknown): s is string {
    return typeof s === "string" && s.trim().length > 0;
}
function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
    catch { return false; }
}
function normUrl(s: string): string {
    try { const u = new URL(s); u.hash = ""; return u.toString(); }
    catch { return s.trim(); }
}
function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
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

export async function POST(req: NextRequest) {
    let decoded: any;
    try {
        decoded = await verifySession(req); // { uid, email, claims?: { userTier? } }
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Unauthorized" }, { status: 401 });
    }

    const json = (await req.json().catch(() => ({}))) as Body;

    // Normalize inputs
    const controllerVersion = isNonEmptyString(json.controllerVersion) ? json.controllerVersion.trim() : undefined;
    const incomingUrl = isHttpUrl(json.url) ? normUrl(json.url!) : undefined;
    const incomingNameHint = isNonEmptyString(json.nameHint) ? json.nameHint!.trim() : undefined;

    let key = isNonEmptyString(json.key) ? json.key.trim() : undefined;
    let keys = Array.isArray(json.keys) ? json.keys.filter(isNonEmptyString).map(k => k.trim()) : undefined;

    // If no keys but a URL is present, generate first (longer preflight)
    if (!key && !(keys && keys.length) && incomingUrl) {
        try {
            const gen = await callBackend(req, {
                path: "/generate-screenshots",
                method: "POST",
                body: { url: incomingUrl },
                timeoutMs: 180_000,
                acceptOnTimeout: true,
                userCtx: {
                    uid: decoded.uid,
                    email: decoded?.email || "",
                    tier: decoded?.userTier ?? decoded?.claims?.userTier ?? null,
                },
            });

            if (!gen.upstream.ok && gen.status !== 504) {
                return NextResponse.json(
                    { error: gen.json?.error || "Backend error (generate)" },
                    { status: gen.status, headers: { "x-request-id": gen.reqId, "cache-control": "no-store" } }
                );
            }

            const g = gen.json ?? {};
            if (Array.isArray(g.keys) && g.keys.length) keys = g.keys.filter(isNonEmptyString);
            else if (isNonEmptyString(g.key)) key = g.key;
            else if (isNonEmptyString(g?.result?.key)) key = g.result.key;
            else if (Array.isArray(g?.result?.keys) && g.result.keys.length) keys = g.result.keys.filter(isNonEmptyString);
        } catch (e: any) {
            return NextResponse.json({ error: e?.message || "Proxy failed (generate)" }, { status: 502 });
        }
    }

    // Consolidate keys
    const outKeys = (keys && keys.length ? keys : (key ? [key] : []))
        .map(k => k.trim())
        .filter(Boolean)
        .slice(0, 25); // hard cap to avoid abuse

    if (!outKeys.length) {
        return NextResponse.json({ error: "Missing storage key(s); provide key/keys or a valid url" }, { status: 400 });
    }

    // Namespace check: keys must belong to this user
    for (const k of outKeys) {
        if (!keyBelongsToUser(k, decoded.uid)) {
            return NextResponse.json({ error: "Forbidden key namespace" }, { status: 403 });
        }
    }

    // Infer urlHash and nameHint if possible
    const urlHash =
        incomingUrl ? hash64(incomingUrl) :
            extractHashFromKey(outKeys[0]) || undefined;

    const nameHint =
        incomingNameHint ||
        (incomingUrl ? new URL(incomingUrl).hostname : undefined);

    try {
        const r = await callBackend(req, {
            path: "/preview-render",
            method: "POST",
            body: {
                url: incomingUrl,
                keys: outKeys,
                nameHint: nameHint ?? null,
                urlHint: incomingUrl,             // allows backend to persist url
                urlHash: urlHash,             // allows backend to persist urlHash
                controllerVersion,                // transparent forward if provided
            },
            timeoutMs: 240_000,
            acceptOnTimeout: true,
            userCtx: {
                uid: decoded.uid,
                email: decoded?.email || "",
                tier: decoded?.userTier ?? decoded?.claims?.userTier ?? null,
            },
        });

        const okJson = r.json && Object.keys(r.json).length ? r.json : { ok: true };
        const status = r.upstream.ok ? 200 : (r.status === 504 || r.status === 524 ? 202 : r.status);

        return NextResponse.json(
            status === 202 ? { ...okJson, queued: true } : (r.upstream.ok ? okJson : { error: r.json?.error || "Backend error (render)" }),
            { status, headers: { "x-request-id": r.reqId, "cache-control": "no-store" } }
        );
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Proxy failed (render)" }, { status: 502 });
    }
}
