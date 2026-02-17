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

export type RenderForBuilder = {
    id: string;
    url?: string | null;
    urlHash?: string | null;
    key?: string | null;
    source?: string | null;
    archived?: boolean;
};

function normalizeUrlForMatch(raw: string): string {
    const s = (raw || "").trim();
    if (!s) return "";
    try {
        const u = new URL(s);
        u.hash = "";
        // Avoid treating trailing slash differences as different URLs.
        const normalized = u.toString();
        return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    } catch {
        return s.endsWith("/") ? s.slice(0, -1) : s;
    }
}

/**
 * Filters a set of renders to those relevant to the current /dashboard/view target.
 *
 * Why this exists: Firestore fields can be missing/normalized differently over time
 * (e.g. url variants, urlHash missing, key formats). We still want the UI to show
 * *something* instead of hiding a user's only render.
 */
export function filterRendersForBuilder<T extends RenderForBuilder>(params: {
    all: T[];
    targetUrl: string;
    targetHash?: string | null;
    optimisticKeys?: string[];
    extractHashFromKey?: (key: string) => string | null;
    /**
     * When true, only include renders that match the selected URL (by url/urlHash/key hash).
     * This disables the lenient "show the only render" fallback and excludes community remixes.
     */
    strict?: boolean;
}): T[] {
    const allNonArchived = (params.all || []).filter((r) => !r?.archived);
    const targetUrlNorm = normalizeUrlForMatch(params.targetUrl || "");
    const targetHash = (params.targetHash || "").trim();
    const optimistic = new Set(params.optimisticKeys || []);
    const strict = params.strict === true;

    const filtered = allNonArchived.filter((r) => {
        const rUrl = typeof r.url === "string" ? r.url : "";
        const byUrl = !!rUrl && normalizeUrlForMatch(rUrl) === targetUrlNorm;

        const byHash = !!targetHash && typeof r.urlHash === "string" && r.urlHash === targetHash;

        const byKeyHash =
            !!targetHash &&
            typeof r.key === "string" &&
            typeof params.extractHashFromKey === "function" &&
            params.extractHashFromKey(r.key) === targetHash;

        const byOptimisticKey = typeof r.key === "string" && optimistic.has(r.key);

        // Community remixes don't have url/urlHash; show them regardless (lenient mode only).
        const byCommunityRemix = !strict && r.source === "community_remix";

        return byUrl || byHash || byKeyHash || byOptimisticKey || byCommunityRemix;
    });

    // Severity-1 guardrail (lenient mode only): if the user only has one render, never hide it.
    // This catches cases where the stored render fields don't match the current
    // targetUrl (http/https, trailing slash, missing urlHash, etc.).
    if (!strict && filtered.length === 0 && allNonArchived.length === 1) {
        return allNonArchived;
    }

    return filtered;
}

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
    if (/^https?:\/\//i.test(pathOrUrl)) {
        // If it's already a full URL, use the proxy to avoid CORS issues
        return `/api/user-blob/proxy?url=${encodeURIComponent(pathOrUrl)}`;
    }
    try {
        // Use client-side firebase/storage ref + getStorage to resolve a path to a download URL
        const firebaseUrl = await getDownloadURL(ref(getStorage(), pathOrUrl));
        // Use proxy to avoid CORS issues
        return `/api/user-blob/proxy?url=${encodeURIComponent(firebaseUrl)}`;
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
