import { createHash } from "node:crypto";
import admin from "firebase-admin";

export const WORKSPACE_RESTORE_COLLECTION = "workspace_agent_v3_restore_points";

export function workspaceRestoreMetadata(doc: any) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        createdAt: data.createdAt || null,
        label: data.label || "Workspace edit",
        source: "workspace_autonomy_v3",
        kept: Boolean(data.kept),
        paths: Array.isArray(data.touchedPaths) ? data.touchedPaths : [],
        requestId: data.requestId || null,
        restorable: data.restorable !== false,
    };
}

async function readText(record: any, prefix = ""): Promise<string | null> {
    const field = (name: string) => prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name;
    if (record[field("encoding")] === "base64") return null;
    const storagePath = record[field("storagePath")];
    if (!storagePath) return typeof record[field("content")] === "string" ? record[field("content")] : null;
    try {
        const [bytes] = await admin.storage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "tracksitechanges-5743f.firebasestorage.app").file(storagePath).download();
        return bytes.toString("utf8");
    } catch { return null; }
}

async function currentText(doc: any, path: string): Promise<string | null> {
    const appRef = doc.ref?.parent?.parent;
    if (!appRef) return null;
    const snap = await appRef.get();
    const app = snap.data() || {};
    const inline = app.files?.[path];
    if (typeof inline === "string") return inline;
    if (inline?.content || inline?.storagePath) return readText(inline);
    const shards = await appRef.collection(app.fileStorageCollection || "file_blobs").where("path", "==", path).limit(1).get();
    return shards.docs[0] ? readText(shards.docs[0].data()) : null;
}

// Missing history must never be interpreted as a file deletion. New snapshots
// include both versions; older snapshots can use current bytes only when their
// hash proves they are the exact version saved by that edit.
export async function workspaceRestoreDetails(doc: any, deps: { loadCurrentText?: (path: string) => Promise<string | null> } = {}) {
    const files = await doc.ref.collection("files").get();
    const meta = doc.data() || {};
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    const omittedPaths: string[] = [];
    for (const item of files.docs) {
        const data = item.data() || {};
        const path = String(data.path || "");
        if (!path || /(?:^|\/)\.env(?:\.|$)/i.test(path) || data.encoding === "base64") {
            if (path) omittedPaths.push(path);
            continue;
        }
        const original = data.exists ? await readText(data) : null;
        if (data.exists && original === null) { omittedPaths.push(path); continue; }
        before[path] = original;
        if (typeof data.afterExists === "boolean") {
            const saved = data.afterExists ? await readText(data, "after") : null;
            if (!data.afterExists || saved !== null) after[path] = saved;
        } else if (meta.afterHashes && Object.hasOwn(meta.afterHashes, path)) {
            const expected = meta.afterHashes[path];
            if (expected === null) { after[path] = null; continue; }
            const current = await (deps.loadCurrentText ? deps.loadCurrentText(path) : currentText(doc, path));
            if (current !== null && createHash("sha256").update(current).digest("hex") === expected) after[path] = current;
        }
        if (!Object.hasOwn(after, path)) omittedPaths.push(path);
    }
    return { ok: true, ...workspaceRestoreMetadata(doc), before, after, omittedPaths };
}
