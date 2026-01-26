import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
