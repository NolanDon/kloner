// src/lib/renders.ts
export type RenderRecord = {
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

export async function archiveRender(id: string): Promise<void> {
    return setRenderArchived(id, true);
}

export async function unarchiveRender(id: string): Promise<void> {
    return setRenderArchived(id, false);
}
