// src/lib/apps.ts

export type AppRecord = {
    id: string;
    name?: string | null;
    createdAt?: any;
    updatedAt?: any;

    archived?: boolean;
    archivedAt?: string | number | null;
};

let csrfPromise: Promise<string | null> | null = null;

async function fetchCsrf(): Promise<string | null> {
    try {
        const res = await fetch("/api/auth/csrf", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            cache: "no-store",
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        return (data && (data as any).csrf) || null;
    } catch {
        return null;
    }
}

async function ensureCsrf(forceRefresh = false): Promise<string | null> {
    if (forceRefresh) csrfPromise = null;
    if (!csrfPromise) csrfPromise = fetchCsrf();
    return csrfPromise;
}

async function postWithCsrf(url: string, body: unknown): Promise<Response> {
    const csrf = await ensureCsrf();
    return fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
            ...(csrf ? { "x-csrf": csrf } : {}),
        },
        body: JSON.stringify(body),
    });
}

async function setAppArchived(appId: string, archived: boolean): Promise<void> {
    const url = `/api/app-builder/${encodeURIComponent(appId)}/archive`;

    let res = await postWithCsrf(url, { archived });

    // If token rotated or cookie cleared, retry once with a fresh CSRF token.
    if (!res.ok && res.status === 403) {
        const text = await res.text().catch(() => "");
        if (text.includes("CSRF") || text.toLowerCase().includes("csrf")) {
            await ensureCsrf(true);
            res = await postWithCsrf(url, { archived });
        } else {
            throw new Error(
                `Failed to ${archived ? "archive" : "unarchive"} app: ${text || res.status}`,
            );
        }
    }

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
