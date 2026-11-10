import admin from "firebase-admin";
import { zipSync } from "fflate";
import { hydrateAppBuilderFiles } from "./htmlStorage";

const FIREBASE_STORAGE_BUCKET = [
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    process.env.FIREBASE_STORAGE_BUCKET,
].map(value => String(value || "").trim()).find(Boolean)
    || "tracksitechanges-5743f.firebasestorage.app";

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
    const exportableEntries = Object.entries(records).filter(([path]) => isExportableProjectPath(path));
    const archiveEntries: Array<[string, Uint8Array]> = new Array(exportableEntries.length);
    let nextEntry = 0;
    let legacyFilesPromise: Promise<Record<string, { content?: string }>> | null = null;
    const materializeEntry = async (path: string, record: any): Promise<Uint8Array> => {
        let bytes: Buffer;
        if (currentFile?.path === path) bytes = Buffer.from(currentFile.content, "utf8");
        else if (typeof record.content === "string" && record.content.length) {
            bytes = Buffer.from(record.content, record.encoding === "base64" ? "base64" : "utf8");
        } else if (record.storagePath) {
            [bytes] = await admin.storage().bucket(FIREBASE_STORAGE_BUCKET).file(record.storagePath).download();
        } else if (app.htmlStoragePath && /\.html?$/i.test(path)) {
            legacyFilesPromise ||= hydrateAppBuilderFiles({ ...app, db, uid, appId });
            const legacyFiles = await legacyFilesPromise;
            if (!legacyFiles[path]?.content) throw new Error(`Could not load project file: ${path}`);
            bytes = Buffer.from(legacyFiles[path].content, "utf8");
        } else if (typeof record.content === "string" && !record.sizeBytes) {
            bytes = Buffer.alloc(0);
        } else throw new Error(`Could not load project file: ${path}`);
        return bytes;
    };

    // Sharded projects may contain hundreds of GCS-backed images and fonts.
    // Fetch them with bounded concurrency instead of waiting on each object in turn.
    const workerCount = Math.min(12, exportableEntries.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextEntry++;
            if (index >= exportableEntries.length) return;
            const [path, record] = exportableEntries[index];
            archiveEntries[index] = [path, await materializeEntry(path, record)];
        }
    }));

    const archive: Record<string, Uint8Array> = Object.create(null);
    let totalBytes = 0;
    for (const [path, bytes] of archiveEntries) {
        totalBytes += bytes.byteLength;
        if (totalBytes > 100 * 1024 * 1024) throw new Error("This project exceeds the 100 MB download limit.");
        archive[path] = bytes;
    }
    if (!Object.keys(archive).length) throw new Error("The project has no files to download yet.");
    return archive;
}

export async function buildProjectDownload(params: Parameters<typeof loadProjectFileBytes>[0]): Promise<Uint8Array> {
    return zipSync(await loadProjectFileBytes(params), { level: 6 });
}
