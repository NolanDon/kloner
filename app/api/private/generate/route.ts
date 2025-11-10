// src/app/api/private/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { verifySession } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
    catch { return false; }
}

export async function POST(req: NextRequest) {
    // Require a signed-in user; middleware downstream needs req.user.uid
    let decoded;
    try {
        decoded = await verifySession(req); // { uid, email, claims?: { userTier? } }
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Unauthorized" }, { status: 401 });
    }

    const { url } = (await req.json().catch(() => ({}))) as { url?: string };
    if (!isHttpUrl(url)) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    try {
        const r = await callBackend(req, {
            path: "/generate-screenshots",      // mounted at router.use('/generate-screenshots'...)
            method: "POST",
            body: { url },
            timeoutMs: 60_000,
            acceptOnTimeout: true,
            userCtx: {
                uid: decoded.uid,
                email: decoded?.email || "",
                tier: (decoded as any)?.userTier ?? (decoded as any)?.claims?.userTier ?? null,
            },
        });

        if (!r.upstream.ok) {
            return NextResponse.json(
                { error: r.json?.error || "Backend error" },
                { status: r.status, headers: { "x-request-id": r.reqId, "cache-control": "no-store" } }
            );
        }

        const payload =
            r.json && Object.keys(r.json).length
                ? r.json
                : { ok: true, queued: r.status === 202 || r.status === 204 };

        return NextResponse.json(payload, {
            status: 200,
            headers: { "x-request-id": r.reqId, "cache-control": "no-store" },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 502 });
    }
}
