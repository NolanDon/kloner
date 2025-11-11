// /app/api/img/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = process.env.FB_STORAGE_BUCKET || "tracksitechanges-5743f.appspot.com";
// e.g. set FB_STORAGE_BUCKET="tracksitechanges-5743f.appspot.com" in Vercel

const storage = new Storage(); // uses GOOGLE_APPLICATION_CREDENTIALS

function ok(res: Response, headers: Headers) {
    // copy upstream headers but enforce image content-type and safe caching
    const h = new Headers();
    h.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
    h.set("Content-Type", headers.get("Content-Type") || "image/jpeg");
    h.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new NextResponse(res.body, { status: 200, headers: h });
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key"); // preferred
    const url = searchParams.get("url"); // fallback (will be fetched server-side)

    try {
        if (key) {
            // stream from GCS by bucket + object path
            const file = storage.bucket(BUCKET).file(key);
            const [exists] = await file.exists();
            if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

            const [meta] = await file.getMetadata().catch(() => [{ contentType: "image/jpeg" } as any]);
            const stream = file.createReadStream(); // signed creds pull

            const headers = new Headers();
            headers.set("Content-Type", meta.contentType || "image/jpeg");
            headers.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
            headers.set("Cross-Origin-Resource-Policy", "cross-origin");

            // @ts-ignore – NextResponse can take a Readable stream in Node runtime
            return new NextResponse(stream as any, { status: 200, headers });
        }

        if (url) {
            // defensive server-side fetch of legacy URLs
            const r = await fetch(url, { redirect: "follow" });
            if (!r.ok) return NextResponse.json({ error: "Upstream error" }, { status: 502 });
            return ok(r as any, r.headers);
        }

        return NextResponse.json({ error: "Missing key|url" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Proxy error" }, { status: 500 });
    }
}
