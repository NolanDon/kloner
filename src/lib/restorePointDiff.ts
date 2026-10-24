export type RestorePointDiffDetail = { paths?: string[]; before?: Record<string, string | null>; after?: Record<string, string | null> };

function normalizeLines(text: string): string[] {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function countLineDelta(beforeText: string, afterText: string): { added: number; removed: number } {
    const before = normalizeLines(beforeText);
    const after = normalizeLines(afterText);

    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
        prefix += 1;
    }

    let suffix = 0;
    while (
        suffix < before.length - prefix &&
        suffix < after.length - prefix &&
        before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
        suffix += 1;
    }

    const removed = Math.max(0, before.length - prefix - suffix);
    const added = Math.max(0, after.length - prefix - suffix);
    return { added, removed };
}

export function summarizeRestorePointDiff(detail: RestorePointDiffDetail | null | undefined): Array<{ path: string; added: number; removed: number; beforeLines: number; afterLines: number }> {
    if (!detail?.before && !detail?.after) return [];

    const paths = Array.from(new Set([
        ...(detail.paths || []),
        ...Object.keys(detail.before || {}),
        ...Object.keys(detail.after || {}),
    ])).filter((path) => Boolean(path) && Object.prototype.hasOwnProperty.call(detail.before || {}, path) && Object.prototype.hasOwnProperty.call(detail.after || {}, path));

    return paths.map((path) => {
        const beforeText = String(detail.before?.[path] ?? "");
        const afterText = String(detail.after?.[path] ?? "");
        const delta = countLineDelta(beforeText, afterText);
        return {
            path,
            added: delta.added,
            removed: delta.removed,
            beforeLines: normalizeLines(beforeText).length,
            afterLines: normalizeLines(afterText).length,
        };
    });
}

export function buildRestorePointDiffPreview(detail: RestorePointDiffDetail | null | undefined, path: string): { before: string; after: string } | null {
    if (!detail) return null;
    if (!Object.prototype.hasOwnProperty.call(detail.before || {}, path) || !Object.prototype.hasOwnProperty.call(detail.after || {}, path)) return null;
    const before = String(detail.before?.[path] ?? "");
    const after = String(detail.after?.[path] ?? "");
    if (before === after) return null;
    if (Math.max(before.length, after.length) > 8000) {
        let prefix = 0;
        while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
        let suffix = 0;
        while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
        const excerpt = (text: string) => {
            const start = Math.max(0, prefix - 160);
            const end = Math.min(text.length, text.length - suffix + 160);
            const changed = text.slice(start, end);
            const shortened = changed.length > 3200 ? changed.slice(0, 1600) + "\n… preview shortened …\n" + changed.slice(-1600) : changed;
            return (start > 0 ? "…\n" : "") + shortened + (end < text.length ? "\n…" : "");
        };
        return { before: excerpt(before), after: excerpt(after) };
    }
    return { before, after };
}

