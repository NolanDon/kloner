import { deleteObject, ref } from "firebase/storage";
import { storage } from "@/lib/firebase";

export const IMAGE_STORAGE_LIMIT_BYTES = Number(
    process.env.NEXT_PUBLIC_IMAGE_STORAGE_LIMIT_BYTES || 250 * 1024 * 1024,
);
const IMAGE_STORAGE_CHANGED_EVENT = "kloner:image-storage-changed";

const IMAGE_STORAGE_PREFIXES = ["kloner_images", "kloner_ai_home"] as const;

function sanitizeSegment(value: string, fallback = "asset"): string {
    return String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || fallback;
}

export function formatBytes(bytes: number): string {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    const digits = unit === 0 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(digits)} ${units[unit]}`;
}

export async function loadUserImageStorageUsage(uid: string): Promise<{
    usedBytes: number;
    fileCount: number;
}> {
    const userId = String(uid || "").trim();
    if (!userId) return { usedBytes: 0, fileCount: 0 };
    try {
        const response = await fetch("/api/user-blob/usage", {
            method: "GET",
            credentials: "include",
        });

        const data = await response.json().catch(() => ({} as any));
        if (!response.ok) {
            throw new Error(data?.error || `Usage lookup failed (HTTP ${response.status})`);
        }

        return {
            usedBytes: Number(data?.usedBytes || 0),
            fileCount: Number(data?.fileCount || 0),
        };
    } catch {
        return { usedBytes: 0, fileCount: 0 };
    }
}

export async function ensureUserImageStorageRoom(uid: string, incomingBytes: number): Promise<{
    ok: boolean;
    usedBytes: number;
    limitBytes: number;
}> {
    const { usedBytes } = await loadUserImageStorageUsage(uid);
    return {
        ok: usedBytes + Math.max(0, Number(incomingBytes) || 0) <= IMAGE_STORAGE_LIMIT_BYTES,
        usedBytes,
        limitBytes: IMAGE_STORAGE_LIMIT_BYTES,
    };
}

export async function uploadUserImageToFirebase(args: {
    uid: string;
    file: Blob;
    fileName: string;
    renderId?: string | null;
}): Promise<{ url: string; path: string; bytes: number }> {
    const uid = String(args.uid || "").trim();
    if (!uid) throw new Error("Missing user id");
    const safeName = sanitizeSegment(args.fileName || "upload.bin");
    const renderId = sanitizeSegment(args.renderId || "orphan", "orphan");
    const url = `/api/user-blob/upload-url?filename=${encodeURIComponent(safeName)}&renderId=${encodeURIComponent(renderId)}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": (args.file as any)?.type || "application/octet-stream",
        },
        credentials: "include",
        body: args.file,
    });

    const data = await response.json().catch(() => ({} as any));
    if (!response.ok || !data?.url || !data?.path) {
        throw new Error(data?.error || `Upload failed (HTTP ${response.status})`);
    }

    try {
        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent(IMAGE_STORAGE_CHANGED_EVENT, {
                    detail: {
                        uid,
                        deltaBytes: Number((args.file as any)?.size || 0),
                        deltaFiles: 1,
                        path: data.path as string,
                        bytes: Number((args.file as any)?.size || 0),
                        kind: "upload",
                    },
                }),
            );
        }
    } catch {
        // ignore event dispatch failures
    }

    return {
        url: data.url as string,
        path: data.path as string,
        bytes: Number((args.file as any)?.size || 0),
    };
}

export async function deleteUserImagePath(path: string): Promise<void> {
    const trimmed = String(path || "").trim();
    if (!trimmed) return;
    await deleteObject(ref(storage, trimmed));

    try {
        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent(IMAGE_STORAGE_CHANGED_EVENT, {
                    detail: {
                        path: trimmed,
                        kind: "delete",
                    },
                }),
            );
        }
    } catch {
        // ignore event dispatch failures
    }
}
