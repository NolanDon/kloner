// app/api/user-storage/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";

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
    try {
        const { paths } = (await req.json()) as { paths?: string[] };

        if (!Array.isArray(paths) || paths.length === 0) {
            return NextResponse.json(
                { ok: false, error: "No paths provided" },
                { status: 400 }
            );
        }

        const bucket = getBucket();

        await Promise.all(
            paths.map(async (p) => {
                if (!p || typeof p !== "string") return;
                try {
                    await bucket.file(p).delete();
                } catch (e) {
                    console.error("storage delete failed", p, e);
                }
            })
        );

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error("user-storage delete error", err);
        return NextResponse.json(
            { ok: false, error: err?.message || "delete_failed" },
            { status: 500 }
        );
    }
}
