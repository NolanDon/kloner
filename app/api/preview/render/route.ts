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
    url?: string; // optional: trigger generation if no keys
};

function isNonEmptyString(s: unknown): s is string {
    return typeof s === "string" && s.trim().length > 0;
}
function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
    catch { return false; }
}

export async function POST(req: NextRequest) {
    let decoded;
    try {
        decoded = await verifySession(req);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Unauthorized" }, { status: 401 });
    }

    const json = (await req.json().catch(() => ({}))) as Body;

    let key = isNonEmptyString(json.key) ? json.key.trim() : undefined;
    let keys = Array.isArray(json.keys) ? json.keys.filter(isNonEmptyString) : undefined;

    // If no keys but a URL is present, generate first (increase timeout here).
    if (!key && !(keys && keys.length) && isHttpUrl(json.url)) {
        try {
            const gen = await callBackend(req, {
                path: "/generate-screenshots",
                method: "POST",
                body: { url: json.url },
                timeoutMs: 180_000,          // ← was 60_000; longer preflight
                acceptOnTimeout: true,       // surface 202 if it runs long
                userCtx: {
                    uid: decoded.uid,
                    email: decoded?.email || "",
                    tier: (decoded as any)?.userTier ?? (decoded as any)?.claims?.userTier ?? null,
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

    const outKeys = (keys && keys.length) ? keys : (key ? [key] : []);
    if (!outKeys.length) {
        return NextResponse.json({ error: "Missing storage key(s); provide key/keys or a valid url" }, { status: 400 });
    }

    try {
        const r = await callBackend(req, {
            path: "/preview-render",
            method: "POST",
            body: {
                keys: outKeys,
                nameHint: json.nameHint ?? null,
                urlHint: isHttpUrl(json.url) ? json.url : undefined,
            },
            timeoutMs: 240_000,            // render path cap
            acceptOnTimeout: true,         // surface 202 to client
            userCtx: {
                uid: decoded.uid,
                email: decoded?.email || "",
                tier: (decoded as any)?.userTier ?? (decoded as any)?.claims?.userTier ?? null,
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
