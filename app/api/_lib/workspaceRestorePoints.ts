export const WORKSPACE_RESTORE_COLLECTION = "workspace_agent_v3_restore_points";

export function workspaceRestoreMetadata(doc: any) {
    const data = doc.data() || {};
    return {
        id: doc.id,
        createdAt: data.createdAt || null,
        label: data.label || "Workspace edit",
        source: "workspace_autonomy_v3",
        kept: Boolean(data.kept),
        paths: Array.isArray(data.touchedPaths) ? data.touchedPaths : [],
        requestId: data.requestId || null,
        restorable: data.restorable !== false,
    };
}

// Details are for display only. Apply always delegates to the V3 backend so
// per-file conflict checks, snapshot completeness and restore leases remain intact.
export async function workspaceRestoreDetails(doc: any) {
    const files = await doc.ref.collection("files").get();
    const before: Record<string, string | null> = {};
    const omittedPaths: string[] = [];
    for (const item of files.docs) {
        const data = item.data() || {};
        const path = String(data.path || "");
        if (!path || /(?:^|\/)\.env(?:\.|$)/i.test(path) || data.encoding === "base64" || data.storagePath) {
            if (path) omittedPaths.push(path);
            continue;
        }
        before[path] = data.exists ? String(data.content || "") : null;
    }
    return { ok: true, ...workspaceRestoreMetadata(doc), before, omittedPaths };
}
