import { NextRequest, NextResponse } from "next/server";
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

type DeleteBody = {
    paths?: string[];
    prefixes?: string[];
    renderId?: string;
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        try {
            const body = (await authedReq.json()) as DeleteBody;
            const paths = Array.isArray(body.paths) ? body.paths : [];
            const prefixes = Array.isArray(body.prefixes) ? body.prefixes : [];

            const allowedPrefixes = [
                `kloner_images/${uid}/`,
                `kloner_ai_home/${uid}/`,
                `kloner-screenshots/${uid}/`,
                `screenshots/${uid}/`,
                `kloner-site-zips/${uid}/`,
                `site-zips/${uid}/`,
            ];

            const toDelete = paths
                .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                .filter((p) => allowedPrefixes.some((prefix) => p.startsWith(prefix)));

            const toDeletePrefixes = prefixes
                .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                .filter((p) => allowedPrefixes.some((prefix) => p.startsWith(prefix)));

            if (!toDelete.length && !toDeletePrefixes.length) {
                return NextResponse.json({ ok: true, count: 0 });
            }

            const bucket = getBucket();
            await Promise.allSettled(
                toDelete.map((path) => bucket.file(path).delete({ ignoreNotFound: true })),
            );

            for (const prefix of toDeletePrefixes) {
                try {
                    const [files] = await bucket.getFiles({ prefix });
                    await Promise.allSettled(files.map((file) => file.delete({ ignoreNotFound: true })));
                } catch (error) {
                    console.warn("[user-blob/delete] prefix cleanup failed", { prefix, error });
                }
            }

            return NextResponse.json({ ok: true, count: toDelete.length + toDeletePrefixes.length });
        } catch (err: any) {
            console.error("user-storage delete error", err);
            return NextResponse.json(
                { ok: false, error: err?.message || "delete_failed" },
                { status: 500 },
            );
        }
    });
}
