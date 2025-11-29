import { getDownloadURL, getStorage, ref } from "firebase/storage";
import React from "react";

// src/lib/renders.ts
export type RenderRecord = {
    url: any;
    id: string;
    status: string;
    html?: string | null;
    key?: string | null;
    nameHint?: string | null;
    controllerVersion?: string | null;
    lastExportedAt?: string | number | null;
    siteConfigId?: string | null;

    // archive-related
    archived?: boolean;
    archivedAt?: string | number | null;
};

// Fetch all renders for the current user
export async function getUserRenders(): Promise<RenderRecord[]> {
    const res = await fetch("/api/user-renders", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
    });

    if (!res.ok) {
        throw new Error("Failed to load renders");
    }

    const json = await res.json().catch(() => ({}));
    const list = (json?.renders ?? json ?? []) as RenderRecord[];

    return Array.isArray(list) ? list : [];
}

// Internal helper to toggle archive flag
async function setRenderArchived(id: string, archived: boolean): Promise<void> {
    const res = await fetch(`/api/user-renders/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({ archived }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `Failed to ${archived ? "archive" : "unarchive"} render: ${text || res.status
            }`,
        );
    }
}



export async function resolveStorageUrl(
    pathOrUrl: string
): Promise<string> {
    if (!pathOrUrl) return "";
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    try {
        // Use client-side firebase/storage ref + getStorage to resolve a path to a download URL
        return await getDownloadURL(ref(getStorage(), pathOrUrl));
    } catch {
        return "";
    }
}
export function useResolvedImg(pathOrUrl: string) {
    const [src, setSrc] = React.useState("");
    const retriedRef = React.useRef(false);

    const refresh = React.useCallback(async () => {
        const u = await resolveStorageUrl(pathOrUrl);
        if (u) setSrc(u);
    }, [pathOrUrl]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const onError = React.useCallback(() => {
        if (!retriedRef.current) {
            retriedRef.current = true;
            refresh();
        }
    }, [refresh]);

    return { src, onError };
}

export async function archiveRender(id: string): Promise<void> {
    return setRenderArchived(id, true);
}

export async function unarchiveRender(id: string): Promise<void> {
    return setRenderArchived(id, false);
}
