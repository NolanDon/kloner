// src/lib/apps.ts

export type AppRecord = {
    id: string;
    name?: string | null;
    createdAt?: any;
    updatedAt?: any;

    archived?: boolean;
    archivedAt?: string | number | null;
};

async function setAppArchived(appId: string, archived: boolean): Promise<void> {
    const res = await fetch(
        `/api/app-builder/${encodeURIComponent(appId)}/archive`,
        {
            method: "POST",
            credentials: "include",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({ archived }),
        }
    );

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `Failed to ${archived ? "archive" : "unarchive"} app: ${
                text || res.status
            }`,
        );
    }
}

export async function archiveApp(appId: string): Promise<void> {
    return setAppArchived(appId, true);
}

export async function unarchiveApp(appId: string): Promise<void> {
    return setAppArchived(appId, false);
}
