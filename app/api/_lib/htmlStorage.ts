import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";

export type AppBuilderFileRecord = { content: string; lastModified: number };
export type AppBuilderFiles = Record<string, AppBuilderFileRecord>;

export type AppBuilderManifestEntry = {
    path?: unknown;
    filePath?: unknown;
    targetPath?: unknown;
    htmlPath?: unknown;
    entryPath?: unknown;
    content?: unknown;
    data?: unknown;
    text?: unknown;
    source?: unknown;
    storagePath?: unknown;
    inline?: unknown;
    kind?: unknown;
    encoding?: unknown;
    contentType?: unknown;
    lastModified?: unknown;
    updatedAt?: unknown;
    createdAt?: unknown;
    sizeBytes?: unknown;
    isHtml?: unknown;
};

export type AppBuilderFileManifest = {
    bundleVersion?: unknown;
    entryPoints?: unknown;
    fileCount?: unknown;
    files?: unknown;
    groups?: unknown;
    [key: string]: unknown;
};

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

function isHtmlPath(path: string): boolean {
    return /\.(html?|xhtml)$/i.test(String(path || ""));
}

function isLikelyHtmlPathHint(value: string): boolean {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (raw.length > 200) return false;
    if (/\s/.test(raw)) return false;
    return /(^|\/)[^/]+\.(html?|xhtml)$/i.test(raw);
}

function collectCandidatePaths(value: unknown, out: Set<string>) {
    if (!value || out.size > 50) return;

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (isLikelyHtmlPathHint(trimmed)) {
            out.add(trimmed.replace(/^\/+/, ""));
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) collectCandidatePaths(item, out);
        return;
    }

    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        for (const [key, nested] of Object.entries(record)) {
            if (isLikelyHtmlPathHint(key)) {
                out.add(key.replace(/^\/+/, ""));
            }
            if (key === "path" || key === "filePath" || key === "targetPath" || key === "htmlPath" || key === "entryPath") {
                if (typeof nested === "string" && isLikelyHtmlPathHint(nested)) {
                    out.add(nested.replace(/^\/+/, ""));
                }
            }
            collectCandidatePaths(nested, out);
        }
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function toTimestamp(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object") {
        const maybeMillis = (value as any)?.toMillis;
        if (typeof maybeMillis === "function") {
            try {
                const millis = maybeMillis.call(value);
                if (typeof millis === "number" && Number.isFinite(millis)) return millis;
            } catch {
                // ignore
            }
        }
        const maybeSeconds = (value as any)?.seconds;
        const maybeNanoseconds = (value as any)?.nanoseconds;
        if (typeof maybeSeconds === "number" && Number.isFinite(maybeSeconds)) {
            const nanos = typeof maybeNanoseconds === "number" && Number.isFinite(maybeNanoseconds) ? maybeNanoseconds : 0;
            return maybeSeconds * 1000 + Math.floor(nanos / 1_000_000);
        }
    }
    return Date.now();
}

function getEntryPath(value: unknown): string {
    if (!isPlainObject(value)) return "";
    return asTrimmedString(value.path || value.filePath || value.targetPath || value.htmlPath || value.entryPath);
}

function getEntryInline(value: unknown): boolean | null {
    if (!isPlainObject(value)) return null;
    return typeof value.inline === "boolean" ? value.inline : null;
}

function getEntryEncoding(value: unknown): string {
    if (!isPlainObject(value)) return "utf8";
    const encoding = asTrimmedString(value.encoding || value.contentType);
    return encoding ? encoding.toLowerCase() : "utf8";
}

function getEntryStoragePath(value: unknown): string {
    if (!isPlainObject(value)) return "";
    return asTrimmedString(value.storagePath || value.storage_path || value.blobPath || value.fileStoragePath);
}

function decodeStoredText(raw: string, encoding: string): string {
    const text = String(raw || "");
    if (!text) return "";
    if (encoding === "base64") {
        try {
            return Buffer.from(text, "base64").toString("utf8");
        } catch {
            return text;
        }
    }
    return text;
}

function extractRecordText(record: unknown, encodingHint?: string): string {
    if (!isPlainObject(record)) return "";

    const encoding = (encodingHint || getEntryEncoding(record) || "utf8").toLowerCase();
    const candidates = [record.content, record.data, record.text, record.source];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0) {
            return decodeStoredText(candidate, encoding);
        }
    }

    return "";
}

function getManifestEntryScore(value: unknown): number {
    if (!isPlainObject(value)) return 0;
    return ["path", "inline", "content", "storagePath", "encoding", "kind", "contentType"].reduce(
        (score, key) => score + (typeof (value as any)[key] !== "undefined" ? 1 : 0),
        0,
    );
}

function collectManifestEntries(value: unknown, out: AppBuilderManifestEntry[], limit = 4000) {
    if (!value || out.length >= limit) return;

    if (Array.isArray(value)) {
        for (const item of value) collectManifestEntries(item, out, limit);
        return;
    }

    if (!isPlainObject(value)) return;

    const record = value as Record<string, unknown>;
    const explicitPath = getEntryPath(record);
    const hasFileShape = explicitPath && getManifestEntryScore(record) > 0;

    if (hasFileShape) {
        out.push(record as AppBuilderManifestEntry);
    }

    for (const [key, nested] of Object.entries(record)) {
        if (nested && typeof nested === "object") {
            if (key === "files" || key === "groups" || key === "entryPoints" || key === "primary") {
                collectManifestEntries(nested, out, limit);
                continue;
            }

            if (isPlainObject(nested) && !Array.isArray(nested)) {
                const nestedPath = getEntryPath(nested);
                if (nestedPath && getManifestEntryScore(nested) > 0) {
                    out.push(nested as AppBuilderManifestEntry);
                }
            }

            collectManifestEntries(nested, out, limit);
        }
    }
}

function collectManifestPaths(value: unknown, out: Set<string>, limit = 2000) {
    const entries: AppBuilderManifestEntry[] = [];
    collectManifestEntries(value, entries, limit);

    for (const entry of entries) {
        const path = getEntryPath(entry);
        if (path) out.add(path.replace(/^\/+/, ""));
    }
}

function extractLastModified(record: unknown): number {
    if (!isPlainObject(record)) return Date.now();
    return toTimestamp(record.lastModified || record.updatedAt || record.createdAt);
}

function normalizeInlineFiles(files: AppBuilderFiles | Record<string, unknown> | undefined | null): AppBuilderFiles {
    const out: AppBuilderFiles = {};
    for (const [path, value] of Object.entries((files || {}) as Record<string, unknown>)) {
        if (typeof value === "string") {
            out[path] = { content: value, lastModified: Date.now() };
            continue;
        }

        if (!isPlainObject(value)) continue;
        const record = value as Record<string, unknown>;
        const encoding = getEntryEncoding(record);
        const content = extractRecordText(record, encoding);
        const lastModified = extractLastModified(record);

        out[path] = {
            content,
            lastModified,
        };
    }

    return out;
}

async function readStorageText(storagePath: string, encoding: string): Promise<string | null> {
    const path = String(storagePath || "").trim();
    if (!path) return null;

    try {
        const bucket = getBucket();
        const [buffer] = await bucket.file(path).download();
        const raw = buffer.toString("utf8");
        const decoded = decodeStoredText(raw, encoding);
        return decoded || null;
    } catch (error) {
        console.warn("[html-storage] failed to read file from storage", { storagePath: path, error });
        return null;
    }
}

async function loadShardIndex(params: {
    db?: any;
    uid?: string | null;
    appId?: string | null;
    collectionName?: string | null;
}): Promise<Map<string, any>> {
    const db = params.db;
    const uid = asTrimmedString(params.uid);
    const appId = asTrimmedString(params.appId);
    const collectionName = asTrimmedString(params.collectionName) || "file_blobs";

    if (!db || !uid || !appId || typeof db.collection !== "function") return new Map();

    try {
        const snap = await db
            .collection("kloner_users")
            .doc(uid)
            .collection("kloner_apps")
            .doc(appId)
            .collection(collectionName)
            .get();

        const byPath = new Map<string, any>();
        snap.forEach((doc: any) => {
            const data = typeof doc.data === "function" ? doc.data() : null;
            if (!data) return;
            const path = getEntryPath(data) || asTrimmedString(doc.id);
            if (!path) return;
            byPath.set(path.replace(/^\/+/, ""), data);
        });
        return byPath;
    } catch (error) {
        console.warn("[html-storage] failed to load shard index", { uid, appId, collectionName, error });
        return new Map();
    }
}

function getResolvedRecordContent(record: unknown, fallbackEncoding = "utf8"): string {
    if (!isPlainObject(record)) return "";
    const encoding = getEntryEncoding(record) || fallbackEncoding;
    return extractRecordText(record, encoding);
}

async function hydrateManifestEntry(params: {
    entry: AppBuilderManifestEntry;
    shardRecord?: unknown;
}): Promise<AppBuilderFileRecord> {
    const entry = params.entry || {};
    const shardRecord = params.shardRecord || null;
    const encoding = getEntryEncoding(entry);
    const inline = getEntryInline(entry);
    const storagePath = getEntryStoragePath(entry) || (isPlainObject(shardRecord) ? getEntryStoragePath(shardRecord) : "");
    const entryContent = getResolvedRecordContent(entry, encoding);
    const shardContent = getResolvedRecordContent(shardRecord, encoding);

    let content = "";
    if (inline === true) {
        content = entryContent || shardContent;
    } else if (inline === false) {
        content = shardContent || entryContent;
    } else {
        content = entryContent || shardContent;
    }

    if (!content && storagePath) {
        const storageText = await readStorageText(storagePath, encoding);
        if (storageText) {
            content = storageText;
        }
    }

    if (!content && shardRecord) {
        const shardStoragePath = getEntryStoragePath(shardRecord);
        if (shardStoragePath && shardStoragePath !== storagePath) {
            const storageText = await readStorageText(shardStoragePath, encoding);
            if (storageText) content = storageText;
        }
    }

    if (encoding === "base64" && content) {
        content = decodeStoredText(content, encoding);
    }

    const lastModified = extractLastModified(entry) || extractLastModified(shardRecord);
    return {
        content: content || "",
        lastModified,
    };
}

function pickHtmlTargetPaths(files: AppBuilderFiles, htmlEditIndex: unknown): string[] {
    const hinted = new Set<string>();
    collectCandidatePaths(htmlEditIndex, hinted);

    for (const path of Object.keys(files || {})) {
        if (isHtmlPath(path)) hinted.add(path);
    }

    if (hinted.size === 0) {
        hinted.add("index.html");
    }

    return Array.from(hinted);
}

async function readHtmlFromStorage(storagePath: string): Promise<string | null> {
    const path = String(storagePath || "").trim();
    if (!path) return null;

    try {
        const bucket = getBucket();
        const [buffer] = await bucket.file(path).download();
        const html = buffer.toString("utf8").trim();
        return html || null;
    } catch (error) {
        console.warn("[html-storage] failed to read html from storage", { storagePath: path, error });
        return null;
    }
}

export async function hydrateAppBuilderHtmlFiles(params: {
    files: AppBuilderFiles;
    htmlStoragePath?: string | null;
    htmlEditIndex?: unknown;
}): Promise<AppBuilderFiles> {
    const files = params.files || {};
    const storagePath = typeof params.htmlStoragePath === "string" ? params.htmlStoragePath.trim() : "";
    if (!storagePath) return files;

    const targetPaths = pickHtmlTargetPaths(files, params.htmlEditIndex);
    const needsHydration = targetPaths.some((path) => !String(files?.[path]?.content || "").trim());
    if (!needsHydration) return files;

    const html = await readHtmlFromStorage(storagePath);
    if (!html) return files;

    const next: AppBuilderFiles = { ...files };
    let applied = false;

    for (const path of targetPaths) {
        const current = next[path];
        if (current && String(current.content || "").trim()) continue;

        next[path] = {
            content: html,
            lastModified: current?.lastModified || Date.now(),
        };
        applied = true;

        if (Object.prototype.hasOwnProperty.call(files, path)) {
            break;
        }
    }

    if (!applied && !Object.keys(files || {}).some((path) => isHtmlPath(path))) {
        next["index.html"] = {
            content: html,
            lastModified: Date.now(),
        };
    }

    return next;
}

export async function hydrateAppBuilderFiles(params: {
    db?: any;
    uid?: string | null;
    appId?: string | null;
    files?: AppBuilderFiles | Record<string, unknown>;
    fileManifest?: AppBuilderFileManifest | null;
    fileStorageCollection?: string | null;
    fileStorageMode?: string | null;
    containerCode?: string | null;
    htmlStoragePath?: string | null;
    htmlEditIndex?: unknown;
}): Promise<AppBuilderFiles> {
    const inlineFiles = normalizeInlineFiles(params.files);
    const nextFiles: AppBuilderFiles = { ...inlineFiles };

    const manifestEntries: AppBuilderManifestEntry[] = [];
    collectManifestEntries(params.fileManifest, manifestEntries);

    const manifestPaths = new Set<string>();
    for (const entry of manifestEntries) {
        const path = getEntryPath(entry);
        if (!path) continue;
        manifestPaths.add(path.replace(/^\/+/, ""));
    }

    const shardIndex =
        params.fileStorageMode === "sharded" || params.fileManifest
            ? await loadShardIndex({
                db: params.db,
                uid: params.uid,
                appId: params.appId,
                collectionName: params.fileStorageCollection,
            })
            : new Map<string, any>();

    for (const entry of manifestEntries) {
        const path = getEntryPath(entry).replace(/^\/+/, "");
        if (!path) continue;

        const shardRecord = shardIndex.get(path) || null;
        const hydrated = await hydrateManifestEntry({ entry, shardRecord });
        const current = nextFiles[path];
        const existingContent = String(current?.content || "").trim();

        if (entry.inline === true && existingContent) {
            nextFiles[path] = {
                content: current!.content,
                lastModified: current?.lastModified || hydrated.lastModified,
            };
            continue;
        }

        nextFiles[path] = hydrated.content || existingContent
            ? {
                content: hydrated.content || current?.content || "",
                lastModified: hydrated.lastModified || current?.lastModified || Date.now(),
            }
            : {
                content: "",
                lastModified: hydrated.lastModified || current?.lastModified || Date.now(),
            };
    }

    // Preserve any extra inline files that are not described in the manifest.
    for (const [path, record] of Object.entries(inlineFiles)) {
        if (manifestPaths.has(path)) continue;
        const current = nextFiles[path];
        if (current && String(current.content || "").trim()) continue;
        nextFiles[path] = record;
    }

    const storageHydrated = await hydrateAppBuilderHtmlFiles({
        files: nextFiles,
        htmlStoragePath: params.htmlStoragePath,
        htmlEditIndex: params.htmlEditIndex,
    });

    return storageHydrated;
}