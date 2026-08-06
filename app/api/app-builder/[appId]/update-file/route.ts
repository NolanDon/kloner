// app/api/app-builder/[appId]/update-file/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import {
    buildAppBuilderFileStoragePath,
    writeStorageText,
} from "../../../_lib/htmlStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INLINE_FIRESTORE_LIMIT_BYTES = 900_000;

function isEnvPath(path: string): boolean {
    const lower = String(path || "").toLowerCase();
    const base = lower.split("/").pop() || lower;
    return base === ".env" || base.startsWith(".env.");
}

function sanitizeRelativePath(input: unknown): string | null {
    const raw = typeof input === "string" ? input.trim() : "";
    if (!raw) return null;
    if (raw.startsWith("/")) return null;
    if (raw.includes("\\")) return null;

    const parts = raw.split("/");
    for (const part of parts) {
        if (!part) return null;
        if (part === "." || part === "..") return null;
    }

    return raw;
}

function normalizeJsTsConfig(path: string, content: string): { ok: true; content: string } | { ok: false; error: string } {
    const lower = path.toLowerCase();
    const isConfig = lower === "tsconfig.json" || lower.endsWith("/tsconfig.json") || lower === "jsconfig.json" || lower.endsWith("/jsconfig.json");
    if (!isConfig) return { ok: true, content };

    let parsed: any;
    try {
        parsed = JSON.parse(content);
    } catch {
        return { ok: false, error: "Invalid JSON in tsconfig/jsconfig." };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "tsconfig/jsconfig must be a JSON object." };
    }

    // Next's dev bundler can crash if compilerOptions is missing (it reads baseUrl without null checks).
    if (!parsed.compilerOptions || typeof parsed.compilerOptions !== "object" || Array.isArray(parsed.compilerOptions)) {
        parsed.compilerOptions = {};
    }

    return { ok: true, content: JSON.stringify(parsed, null, 2) + "\n" };
}

function usesShardedFileStorage(data: any): boolean {
    return data?.fileStorageMode === "sharded" || Boolean(data?.fileManifest) || Boolean(data?.fileStorageCollection);
}

export async function POST(
    req: NextRequest,
    { params }: any
) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
        const db = getAdminDb();
        const appId = (await Promise.resolve(params))?.appId;

        // Prevent request tampering: must match the active app scope cookie.
        assertAppBuilderScope(authedReq, uid, appId);

        const body = await req.json();
        const { path, content } = body;

        const sanitizedPath = sanitizeRelativePath(path);
        if (!sanitizedPath || typeof content !== "string") {
            return NextResponse.json({ error: "Invalid request" }, { status: 400 });
        }

        if (isEnvPath(sanitizedPath)) {
            return NextResponse.json(
                { error: "Refusing to write .env files. Use Vercel env vars for deploy, and preview env sync for local preview." },
                { status: 400 },
            );
        }

        const normalized = normalizeJsTsConfig(sanitizedPath, content);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const docRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const data = doc.data();
        if (!data) {
            return NextResponse.json({ error: "App data not found" }, { status: 404 });
        }

        const usesShardedFiles = usesShardedFileStorage(data);
        const contentBytes = Buffer.byteLength(normalized.content, "utf8");
        const shouldUseStorage = contentBytes > INLINE_FIRESTORE_LIMIT_BYTES;
        const storagePath = shouldUseStorage
            ? buildAppBuilderFileStoragePath({
                uid,
                appId,
                filePath: sanitizedPath,
            })
            : "";

        if (shouldUseStorage) {
            await writeStorageText({
                storagePath,
                content: normalized.content,
                contentType: /\.html?$/i.test(sanitizedPath) ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
            });
        }

        if (usesShardedFiles) {
            const collectionName = typeof data?.fileStorageCollection === "string" && data.fileStorageCollection.trim()
                ? data.fileStorageCollection.trim()
                : "file_blobs";
            const blobCol = docRef.collection(collectionName);
            const existing = await blobCol.where("path", "==", sanitizedPath).limit(1).get();

            const existingDoc = !existing.empty ? existing.docs[0] : null;
            const existingData = existingDoc?.data() || {};
            const payload = {
                ...existingData,
                path: sanitizedPath,
                content: shouldUseStorage ? "" : normalized.content,
                encoding: "utf8",
                inline: shouldUseStorage ? false : (typeof existingData?.inline === "boolean" ? existingData.inline : true),
                kind: typeof existingData?.kind === "string" ? existingData.kind : "text",
                ...(shouldUseStorage ? { storagePath } : {}),
                lastModified: Date.now(),
                updatedAt: new Date(),
            };

            if (existingDoc) {
                await existingDoc.ref.set(payload, { merge: true });
            } else {
                await blobCol.add(payload);
            }

            await docRef.update({
                updatedAt: new Date(),
            });
        } else {
            const nextFiles = { ...(data?.files || {}) };
            nextFiles[sanitizedPath] = shouldUseStorage
                ? {
                    content: "",
                    lastModified: Date.now(),
                    storagePath,
                }
                : { content: normalized.content, lastModified: Date.now() };

            await docRef.update({
                files: nextFiles,
                updatedAt: new Date(),
            });
        }

        return NextResponse.json({ success: true });
        },
        { csrf: true, methods: ["POST"] }
    );
}
