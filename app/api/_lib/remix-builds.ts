// app/api/_lib/remix-builds.ts
import { getAdminDb } from "../_lib/auth";
import { FieldValue } from "firebase-admin/firestore";

type CreateBuildInput = {
    uid: string;
    sourceRenderId: string;
    html: string;
    name?: string;
    screenshotKey?: string;
};

export async function createRemixBuildOnce(input: CreateBuildInput) {
    const { uid, sourceRenderId, html, name, screenshotKey } = input;
    const db = getAdminDb();
    const col = db.collection("remix_builds");

    // UNIQUE KEY: user + sourceRenderId
    const docId = `${uid}__${sourceRenderId}`;
    const ref = col.doc(docId);

    try {
        await ref.create({
            author: uid,
            sourceRenderId,
            html,
            name: name || "Untitled build",
            screenshotKey: screenshotKey ?? null,
            remixable: true,
            approved: false,
            createdAt: FieldValue.serverTimestamp(),
        });
        const snap = await ref.get();
        return {
            duplicate: false,
            id: ref.id,
            data: snap.data(),
        };
    } catch (err: any) {
        // "already exists" – Firestore admin uses gRPC status 6 for this
        const code = err?.code ?? err?.status;
        if (code === 6 || code === "already-exists" || err?.message?.includes("ALREADY_EXISTS")) {
            const snap = await ref.get();
            return {
                duplicate: true,
                id: ref.id,
                data: snap.data(),
            };
        }
        throw err;
    }
}
