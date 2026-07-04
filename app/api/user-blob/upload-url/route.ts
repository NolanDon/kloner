// app/api/user-blob/upload-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";

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

function sanitizePathSegment(value: string): string {
    return String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "asset";
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            try {
                const { searchParams } = new URL(authedReq.url);
                const filename = searchParams.get("filename") || "upload.bin";
                const renderId = searchParams.get("renderId") || "orphan";
                const safeFilename = sanitizePathSegment(filename);
                const safeRenderId = sanitizePathSegment(renderId);

                const contentType =
                    authedReq.headers.get("content-type") ||
                    "application/octet-stream";
                const body = await authedReq.arrayBuffer();
                const buffer = Buffer.from(body);

                const assetId = randomUUID();
                const objectPath = `kloner_images/${uid}/${safeRenderId}/${assetId}-${safeFilename}`;
                const token = randomUUID();
                const bucket = getBucket();
                const file = bucket.file(objectPath);

                await file.save(buffer, {
                    resumable: false,
                    contentType,
                    metadata: {
                        cacheControl: "public, max-age=31536000",
                        metadata: {
                            firebaseStorageDownloadTokens: token,
                        },
                    },
                });

                const encodedObjectPath = encodeURIComponent(objectPath);
                const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodedObjectPath}?alt=media&token=${token}`;

                return NextResponse.json({
                    url,
                    path: objectPath,
                    provider: "firebase-storage",
                });
            } catch (err: any) {
                console.error("user-blob upload error", err);
                return NextResponse.json(
                    { error: err?.message || "upload_failed" },
                    { status: 500 }
                );
            }
        }
    );
}
