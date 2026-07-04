import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function collectUsageForPrefix(bucket: Bucket, prefix: string): Promise<{ usedBytes: number; fileCount: number }> {
    const [files, folders] = (await bucket.getFiles({ prefix })) as any;
    let usedBytes = 0;
    let fileCount = 0;

    for (const file of files) {
        try {
            const [meta] = await file.getMetadata();
            const size = Number(meta?.size || 0);
            usedBytes += Number.isFinite(size) && size > 0 ? size : 0;
            fileCount += 1;
        } catch {
            // best effort
        }
    }

    for (const folder of folders) {
        const child = await collectUsageForPrefix(bucket, folder.name);
        usedBytes += child.usedBytes;
        fileCount += child.fileCount;
    }

    return { usedBytes, fileCount };
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            try {
                const bucket = getBucket();
                const prefixes = [
                    `kloner_images/${uid}`,
                    `kloner-images/${uid}`,
                    `kloner_ai_home/${uid}`,
                ];

                let usedBytes = 0;
                let fileCount = 0;
                for (const prefix of prefixes) {
                    const usage = await collectUsageForPrefix(bucket, prefix);
                    usedBytes += usage.usedBytes;
                    fileCount += usage.fileCount;
                }

                return NextResponse.json({
                    usedBytes,
                    fileCount,
                    limitBytes: Number(process.env.NEXT_PUBLIC_IMAGE_STORAGE_LIMIT_BYTES || 250 * 1024 * 1024),
                }, { headers: { "Cache-Control": "no-store" } });
            } catch (err: any) {
                console.error("user-blob usage error", err);
                return NextResponse.json(
                    { usedBytes: 0, fileCount: 0, error: err?.message || "usage_failed" },
                    { status: 500 },
                );
            }
        },
        { methods: ["GET"], csrf: false },
    );
}
