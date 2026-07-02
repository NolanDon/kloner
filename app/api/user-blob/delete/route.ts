// app/api/user-storage/delete/route.ts
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

type DeleteBody = {
    paths?: string[];
    renderId?: string;
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        try {
            const { paths, renderId } = (await req.json()) as DeleteBody;
            const bucket = getBucket();

            // Mode 1: delete by renderId using metadata (ownerUid + renderId)
            // Matches the per-user upload path: kloner_images/<uid>/<assetId>-<filename>
            if (renderId && typeof renderId === "string") {
                const prefixes = ["kloner_images/", "kloner-images/"];
                const files = [];
                for (const prefix of prefixes) {
                    const [matched] = await bucket.getFiles({ prefix });
                    files.push(...matched);
                }

                const toDelete = [];
                const seen = new Set<string>();
                for (const file of files) {
                    if (seen.has(file.name)) continue;
                    seen.add(file.name);
                    try {
                        const [meta] = await file.getMetadata();
                        const m = meta.metadata || {};
                        const ownerUid = m.ownerUid as string | undefined;
                        const fileRenderId = m.renderId as string | undefined;

                        if (ownerUid === uid && fileRenderId === renderId) {
                            toDelete.push(file);
                        }
                    } catch (e) {
                        console.error(
                            "storage delete (by renderId) metadata read failed",
                            file.name,
                            e,
                        );
                    }
                }

                await Promise.all(
                    toDelete.map((file) =>
                        file.delete().catch((e) => {
                            console.error(
                                "storage delete (by renderId) failed",
                                file.name,
                                e,
                            );
                        }),
                    ),
                );

                return NextResponse.json({ ok: true, count: toDelete.length });
            }

            // Mode 2: explicit paths
            if (!Array.isArray(paths) || paths.length === 0) {
                return NextResponse.json(
                    { ok: false, error: "No paths or renderId provided" },
                    { status: 400 },
                );
            }

            await Promise.all(
                paths.map(async (p) => {
                    if (!p || typeof p !== "string") return;

                    const file = bucket.file(p);

                    try {
                        const [meta] = await file.getMetadata();
                        const m = meta.metadata || {};
                        const ownerUid = m.ownerUid as string | undefined;

                        // For new objects: only allow delete if ownerUid matches.
                        // For legacy objects with no ownerUid, allow delete so old
                        // cleanup still works.
                        if (ownerUid && ownerUid !== uid) {
                            console.warn(
                                "storage delete refused: owner mismatch",
                                { path: p, ownerUid, uid },
                            );
                            return;
                        }

                        await file.delete();
                    } catch (e) {
                        console.error("storage delete failed", p, e);
                    }
                }),
            );

            return NextResponse.json({ ok: true });
        } catch (err: any) {
            console.error("user-storage delete error", err);
            return NextResponse.json(
                { ok: false, error: err?.message || "delete_failed" },
                { status: 500 },
            );
        }
    });
}
