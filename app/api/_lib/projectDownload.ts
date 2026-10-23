import admin from "firebase-admin";
import { zipSync } from "fflate";
import { hydrateAppBuilderFiles } from "./htmlStorage";

export function canDownloadProject(user: Record<string, any>): boolean {
    return ["pro", "agency"].includes(String(user.tier || "").toLowerCase())
        && String(user.stripeStatus || "").toLowerCase() === "active"
        && Boolean(user.stripeSubscriptionId);
}

export function isExportableProjectPath(path: string): boolean {
    const parts = path.split("/");
    return Boolean(path) && !/^[a-z]:/i.test(path) && !path.includes("\\") && !parts.some(part =>
        !part || part === "." || part === ".." || part === ".git" || part === "node_modules"
        || part === ".next" || part.toLowerCase() === ".env" || part.toLowerCase().startsWith(".env.")
        || part === ".npmrc" || part === ".yarnrc.yml");
}

// Read original bytes: editor text hydration intentionally decodes binary records
// as text, which would corrupt images and fonts in a source archive.
export async function loadProjectFileBytes({ db, uid, appId, app, currentFile }: {
    db: any; uid: string; appId: string; app: any;
    currentFile?: { path: string; content: string };
}): Promise<Record<string, Uint8Array>> {
    const records: Record<string, any> = Object.assign(Object.create(null), app.files || {});
    if (app.fileStorageMode === "sharded" || app.fileManifest || app.fileStorageCollection) {
        const shards = await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId)
            .collection(app.fileStorageCollection || "file_blobs").get();
        const entries = Array.isArray(app.fileManifest?.files) ? app.fileManifest.files : [];
        const active = entries.length ? new Set(entries.map((entry: any) => entry.path)) : new Set(Object.keys(records));
        for (const path of Object.keys(records)) if (!active.has(path)) delete records[path];
        for (const doc of shards.docs) {
            const record = doc.data();
            if (active.has(record.path)) records[record.path] = record;
        }
        for (const entry of entries) if (!records[entry.path]) records[entry.path] = entry;
    }
    const archive: Record<string, Uint8Array> = Object.create(null);
    let totalBytes = 0;
    let legacyFiles: any;
    for (const [path, record] of Object.entries(records)) {
        if (!isExportableProjectPath(path)) continue;
        let bytes: Buffer;
        if (currentFile?.path === path) bytes = Buffer.from(currentFile.content, "utf8");
        else if (typeof record.content === "string" && record.content.length) {
            bytes = Buffer.from(record.content, record.encoding === "base64" ? "base64" : "utf8");
        } else if (record.storagePath) {
            [bytes] = await admin.storage().bucket().file(record.storagePath).download();
        } else if (app.htmlStoragePath && /\.html?$/i.test(path)) {
            legacyFiles ||= await hydrateAppBuilderFiles({ ...app, db, uid, appId });
            if (!legacyFiles[path]?.content) throw new Error(`Could not load project file: ${path}`);
            bytes = Buffer.from(legacyFiles[path].content, "utf8");
        } else if (typeof record.content === "string" && !record.sizeBytes) {
            bytes = Buffer.alloc(0);
        } else throw new Error(`Could not load project file: ${path}`);
        totalBytes += bytes.length;
        if (totalBytes > 100 * 1024 * 1024) throw new Error("This project exceeds the 100 MB download limit.");
        archive[path] = bytes;
    }
    if (!Object.keys(archive).length) throw new Error("The project has no files to download yet.");
    return archive;
}

export async function buildProjectDownload(params: Parameters<typeof loadProjectFileBytes>[0]): Promise<Uint8Array> {
    return zipSync(await loadProjectFileBytes(params), { level: 6 });
}
