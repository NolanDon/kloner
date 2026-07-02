import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function deleteStoragePath(path: unknown) {
    const storagePath = typeof path === "string" ? path.trim() : "";
    if (!storagePath) return;

    const bucket = getBucket();
    await bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
}

async function deleteUserBlobAssetsForApp(uid: string, appId: string) {
    const bucket = getBucket();
    const prefixes = ["kloner_images/", "kloner-images/"];
    const files = [];
    for (const prefix of prefixes) {
        const [matched] = await bucket.getFiles({ prefix });
        files.push(...matched);
    }
    const matches = [] as Awaited<ReturnType<typeof bucket.file>>[];

    for (const file of files) {
        try {
            const [meta] = await file.getMetadata();
            const metadata = meta.metadata || {};
            const ownerUid = typeof metadata.ownerUid === "string" ? metadata.ownerUid : "";
            const renderId = typeof metadata.renderId === "string" ? metadata.renderId : "";

            if (ownerUid === uid && renderId === appId) {
                matches.push(file);
            }
        } catch (error) {
            console.error("[app-builder/delete] blob metadata read failed", file.name, error);
        }
    }

    await Promise.allSettled(matches.map((file) => file.delete()));
}

async function deleteCollectionInBatches(db: any, colRef: any, batchSize = 400) {
    // Firestore batch limit is 500. Use a little buffer.
    while (true) {
        const snap = await colRef.limit(batchSize).get();
        if (!snap || snap.empty) return;

        const batch = db.batch();
        for (const doc of snap.docs) {
            batch.delete(doc.ref);
        }
        await batch.commit();
    }
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
        const db = getAdminDb();

        const body = await authedReq.json().catch(() => ({} as any));
        const { appId } = body;

        if (!appId || typeof appId !== "string") {
            return NextResponse.json({ error: "App ID required" }, { status: 400 });
        }

        try {
            const appRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
            const existingDoc = await appRef.get();
            const existingData = existingDoc.exists ? (existingDoc.data() || {}) : {};
            const storagePaths = [
                existingData.archiveZipPath,
                existingData.zipPath,
                existingData.htmlStoragePath,
            ];

            const screenshotPaths = Array.isArray(existingData.screenshotPaths) ? existingData.screenshotPaths : [];
            storagePaths.push(...screenshotPaths);

            // Best: use Firestore recursiveDelete (removes doc + ALL subcollections).
            const anyDb = db as any;
            if (typeof anyDb.recursiveDelete === "function") {
                await anyDb.recursiveDelete(appRef);
                console.log("[app-builder/delete] recursiveDelete ok", { uid, appId });
            } else {
                // Fallback: delete known subcollections + any discoverable collections, then delete the doc.
                try {
                    const cols: any[] = (await appRef.listCollections?.()) || [];
                    const names = new Set<string>(["ai_chat", "restore_points", "previews"]);
                    for (const c of cols) {
                        if (c?.id) names.add(String(c.id));
                    }
                    for (const name of names) {
                        await deleteCollectionInBatches(db, appRef.collection(name)).catch(() => undefined);
                    }
                } catch {
                    // ignore
                }

                await appRef.delete();
                console.log("[app-builder/delete] manual delete ok", { uid, appId });
            }

            await Promise.allSettled(storagePaths.map((path) => deleteStoragePath(path)));
            await deleteUserBlobAssetsForApp(uid, appId);

            // Cleanup: older bugs wrote app docs into a top-level collection.
            // Best-effort delete so we don't leave behind ghosts.
            await db.collection("kloner_apps").doc(appId).delete().catch(() => undefined);

            return NextResponse.json({ success: true, appId });
        } catch (error) {
            console.error("Failed to delete app:", error);
            return NextResponse.json({ error: "Failed to delete app" }, { status: 500 });
        }
        },
        { csrf: true, methods: ["POST"] }
    );
}
