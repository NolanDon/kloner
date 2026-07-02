// app/api/user-blob/upload-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";
import { randomUUID } from "crypto";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";

const BUCKET_NAME =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "tracksitechanges-5743f.firebasestorage.app";

let cachedBucket: Bucket | null = null;

function initAdminIfNeeded() {
    if (!admin.apps.length) {
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
}

function getBucket(): Bucket {
    if (cachedBucket) return cachedBucket;
    initAdminIfNeeded();
    cachedBucket = admin.storage().bucket(BUCKET_NAME);
    return cachedBucket;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            try {
                const { searchParams } = new URL(authedReq.url);
                const filename = searchParams.get("filename") || "upload.bin";
                const renderId = searchParams.get("renderId") || "orphan";

                const contentType =
                    authedReq.headers.get("content-type") ||
                    "application/octet-stream";
                const body = await authedReq.arrayBuffer();
                const buffer = Buffer.from(body);

                const bucket = getBucket();

                const assetId = randomUUID();
                const objectPath = `kloner_images/${uid}/${assetId}-${filename}`;

                const file = bucket.file(objectPath);
                const token = randomUUID();

                await file.save(buffer, {
                    contentType,
                    resumable: false,
                    metadata: {
                        cacheControl: "public,max-age=31536000,immutable",
                        metadata: {
                            firebaseStorageDownloadTokens: token,
                            // still record ownership in metadata if you need it later
                            ownerUid: uid,
                            renderId,
                        },
                    },
                });

                const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name
                    }/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;

                const proxiedUrl = `/api/user-blob/proxy?url=${encodeURIComponent(url)}`;

                return NextResponse.json({ url: proxiedUrl, path: objectPath, firebaseUrl: url });
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
