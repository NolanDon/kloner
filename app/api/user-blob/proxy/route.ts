// app/api/user-blob/proxy/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET_NAME =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "tracksitechanges-5743f.firebasestorage.app";

let cachedBucket: Bucket | null = null;

function initAdminIfNeeded() {
    if (admin.apps.length) return;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

    let credJson: admin.ServiceAccount;
    try {
        credJson = JSON.parse(raw);
    } catch {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        credJson = JSON.parse(decoded);
    }

    admin.initializeApp({
        credential: admin.credential.cert(credJson),
        storageBucket: BUCKET_NAME,
    });
}

function getBucket(): Bucket {
    if (cachedBucket) return cachedBucket;
    initAdminIfNeeded();
    cachedBucket = admin.storage().bucket(BUCKET_NAME);
    return cachedBucket;
}

function normalizeHtmlEntityEncoding(value: string): string {
    return String(value || "").replace(/&amp;/g, "&");
}

function parseFirebaseStorageObjectUrl(firebaseUrl: string): { bucket: string; objectPath: string } | null {
    try {
        const url = new URL(normalizeHtmlEntityEncoding(firebaseUrl));

        if (
            !(
                url.hostname === "firebasestorage.googleapis.com" ||
                url.hostname === "storage.googleapis.com"
            )
        ) {
            return null;
        }

        const v0Match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
        if (v0Match) {
            return {
                bucket: decodeURIComponent(v0Match[1]),
                objectPath: decodeURIComponent(v0Match[2]),
            };
        }

        const gsMatch = url.pathname.match(/^\/([^/]+)\/(.+)$/);
        if (gsMatch) {
            return {
                bucket: decodeURIComponent(gsMatch[1]),
                objectPath: decodeURIComponent(gsMatch[2]),
            };
        }

        return null;
    } catch {
        return null;
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const firebaseUrl = normalizeHtmlEntityEncoding(searchParams.get("url") || "");

        if (!firebaseUrl) {
            return NextResponse.json(
                { error: "Missing url parameter" },
                { status: 400 }
            );
        }

        const parsed = parseFirebaseStorageObjectUrl(firebaseUrl);
        if (!parsed) {
            return NextResponse.json(
                { error: "Invalid URL" },
                { status: 400 }
            );
        }

        if (parsed.bucket !== BUCKET_NAME) {
            return NextResponse.json(
                { error: "Invalid bucket" },
                { status: 400 }
            );
        }

        const bucket = getBucket();
        const file = bucket.file(parsed.objectPath);

        let imageBuffer: Buffer;
        let metadata: any = null;
        try {
            [imageBuffer] = await file.download();
            [metadata] = await file.getMetadata().catch(() => [null as any]);
        } catch (downloadErr) {
            // Fallback to the signed Firebase URL if the admin bucket read fails.
            const response = await fetch(firebaseUrl);
            if (!response.ok) {
                throw downloadErr;
            }
            const fallbackBuffer = Buffer.from(await response.arrayBuffer());
            metadata = {
                contentType: response.headers.get("content-type") || "image/jpeg",
                cacheControl: response.headers.get("cache-control") || "public, max-age=31536000",
            };
            imageBuffer = fallbackBuffer;
        }

        const proxyResponse = new NextResponse(new Uint8Array(imageBuffer), {
            status: 200,
            headers: {
                "Content-Type": metadata?.contentType || "image/jpeg",
                "Cache-Control": metadata?.cacheControl || "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });

        return proxyResponse;
    } catch (err: any) {
        console.error("Image proxy error:", err);
        return NextResponse.json(
            { error: err?.message || "proxy_failed" },
            { status: 500 }
        );
    }
}
