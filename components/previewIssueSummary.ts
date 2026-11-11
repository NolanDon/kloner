type PreviewIssueEvent = { kind?: string; status?: number; method?: string; resourceType?: string; url?: string; message?: string; stack?: string; elapsedMs?: number };
export type PreviewIssueCounts = { critical: number; warnings: number };
export type PreviewIssueEvidence = {
    counts: PreviewIssueCounts;
    confirmedBlank: boolean;
    page: Record<string, unknown> | null;
    criticalEvents: PreviewIssueEvent[];
    warningEvents: PreviewIssueEvent[];
    renders: Array<Record<string, unknown>>;
    omittedCriticalEvents: number;
    omittedWarningEvents: number;
};
const EVENT_ARRAY_KINDS: Record<string, string> = { pageErrors: "exception", consoleErrors: "console_error", httpErrors: "http_error", requestFailures: "request_failure", resourceErrors: "resource_error" };
function record(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function eventKey(event: PreviewIssueEvent): string { return [event.kind, event.method, event.status, event.resourceType, event.url, event.message].map(value => String(value || "").toLowerCase()).join("|"); }
function collectEvents(root: unknown): PreviewIssueEvent[] {
    const found = new Map<string, PreviewIssueEvent>(); const visited = new Set<object>();
    const add = (value: unknown, fallbackKind = "") => {
        const item = record(value); if (!item) return; const kind = String(item.kind || fallbackKind || "").toLowerCase(); if (!kind) return;
        const event: PreviewIssueEvent = { kind, status: Number(item.status || 0) || undefined, method: String(item.method || "").slice(0, 12), resourceType: String(item.resourceType || "").slice(0, 32), url: String(item.url || "").slice(0, 500), message: String(item.message || item.error || "").slice(0, 500), stack: String(item.stack || "").slice(0, 1200), elapsedMs: Number(item.elapsedMs || 0) || undefined };
        if (["http_error", "request_failure", "exception", "rejection", "resource_error", "console_error", "csp"].includes(kind)) found.set(eventKey(event), event);
    };
    const visit = (value: unknown, depth = 0) => {
        if (depth > 7) return; if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
        const item = record(value); if (!item || visited.has(item)) return; visited.add(item);
        if (item.kind) add(item); if (Array.isArray(item.events)) item.events.forEach(event => add(event));
        for (const [key, child] of Object.entries(item)) { if (Array.isArray(child) && EVENT_ARRAY_KINDS[key]) child.forEach(event => add(event, EVENT_ARRAY_KINDS[key])); else if (child && typeof child === "object") visit(child, depth + 1); }
    };
    visit(root); return [...found.values()];
}
function hasConfirmedBlank(root: unknown): boolean {
    const visited = new Set<object>(); const visit = (value: unknown, depth = 0): boolean => {
        if (depth > 7) return false; if (Array.isArray(value)) return value.some(item => visit(item, depth + 1));
        const item = record(value); if (!item || visited.has(item)) return false; visited.add(item);
        if (item.confirmedBlank === true || record(item.page)?.blank === true) return true;
        return Object.values(item).some(child => child && typeof child === "object" && visit(child, depth + 1));
    }; return visit(root);
}
function hasRecordedFailure(root: unknown): boolean {
    const visited = new Set<object>(); const visit = (value: unknown, depth = 0): boolean => {
        if (depth > 7) return false; if (Array.isArray(value)) return value.some(item => visit(item, depth + 1));
        const item = record(value); if (!item || visited.has(item)) return false; visited.add(item);
        if (typeof item.errorClass === "string" && item.errorClass.trim()) return true;
        if (String(item.status || "").toLowerCase() === "error" && (item.error || item.message || item.errorCode)) return true;
        return Object.values(item).some(child => child && typeof child === "object" && visit(child, depth + 1));
    }; return visit(root);
}
function hasRecordedWarning(root: unknown): boolean {
    const visited = new Set<object>(); const visit = (value: unknown, depth = 0): boolean => {
        if (depth > 7) return false; if (Array.isArray(value)) return value.some(item => visit(item, depth + 1));
        const item = record(value); if (!item || visited.has(item)) return false; visited.add(item);
        if (typeof item.warningCode === "string" && item.warningCode.trim()) return true;
        return Object.values(item).some(child => child && typeof child === "object" && visit(child, depth + 1));
    }; return visit(root);
}

function blankTime(root: unknown): number | null {
    const visited = new Set<object>(); const candidates: Array<{ elapsedMs: number; firstUsefulMs: number }> = [];
    const visit = (value: unknown, depth = 0, firstUsefulMs = 0) => {
        if (depth > 7) return;
        if (Array.isArray(value)) { value.forEach(child => visit(child, depth + 1, firstUsefulMs)); return; }
        const item = record(value); if (!item || visited.has(item)) return; visited.add(item);
        const useful = Number(item.firstUsefulMs || firstUsefulMs) || firstUsefulMs;
        if (Array.isArray(item.renders)) {
            for (const render of item.renders) {
                const sample = record(render); const elapsedMs = Number(sample?.elapsedMs);
                if (sample?.blank === true && Number.isFinite(elapsedMs) && elapsedMs >= useful) candidates.push({ elapsedMs, firstUsefulMs: useful });
            }
        }
        for (const child of Object.values(item)) if (child && typeof child === "object") visit(child, depth + 1, useful);
    };
    visit(root);
    return candidates.length ? candidates.sort((left, right) => left.elapsedMs - right.elapsedMs)[0].elapsedMs : null;
}
function isCritical(event: PreviewIssueEvent, blank: boolean, at: number | null): boolean {
    const type = String(event.resourceType || "").toLowerCase(); const correlated = at != null && event.elapsedMs != null && Math.abs(event.elapsedMs - at) <= 1500;
    return ["exception", "rejection"].includes(String(event.kind))
        || (event.kind === "resource_error" && ["script", "stylesheet"].includes(type))
        || (["http_error", "request_failure"].includes(String(event.kind)) && ((event.status || 0) >= 500 || ["script", "stylesheet", "document"].includes(type) || (blank && correlated)));
}
export function summarizePreviewIssues(rawDiagnostics: string | null | undefined): PreviewIssueCounts | null {
    if (!rawDiagnostics) return null; let root: unknown; try { root = JSON.parse(rawDiagnostics); } catch { return null; }
    const events = collectEvents(root); const blank = hasConfirmedBlank(root); const at = blankTime(root); const critical = new Set<string>(); const warnings = new Set<string>();
    if (blank) critical.add("confirmed-blank-page");
    if (hasRecordedFailure(root)) critical.add("preview-failure");
    if (hasRecordedWarning(root)) warnings.add("preview-warning");
    for (const event of events) (isCritical(event, blank, at) ? critical : warnings).add(eventKey(event));
    return critical.size || warnings.size ? { critical: critical.size, warnings: warnings.size } : null;
}
export function buildPreviewIssueEvidence(rawDiagnostics: string | null | undefined, fallbackCounts: PreviewIssueCounts | null = null): PreviewIssueEvidence | null {
    if (!rawDiagnostics) return fallbackCounts ? { counts: fallbackCounts, confirmedBlank: false, page: null, criticalEvents: [], warningEvents: [], renders: [], omittedCriticalEvents: 0, omittedWarningEvents: 0 } : null;
    let root: unknown;
    try { root = JSON.parse(rawDiagnostics); } catch { return fallbackCounts ? { counts: fallbackCounts, confirmedBlank: false, page: null, criticalEvents: [], warningEvents: [], renders: [], omittedCriticalEvents: 0, omittedWarningEvents: 0 } : null; }
    const events = collectEvents(root);
    const blank = hasConfirmedBlank(root);
    const at = blankTime(root);
    const criticalEvents = events.filter((event) => isCritical(event, blank, at));
    const warningEvents = events.filter((event) => !isCritical(event, blank, at));
    const counts = summarizePreviewIssues(rawDiagnostics) || fallbackCounts;
    if (!counts) return null;
    const findRuntime = (value: unknown, depth = 0): Record<string, any> | null => {
        if (depth > 7) return null;
        if (Array.isArray(value)) { for (const child of value) { const result = findRuntime(child, depth + 1); if (result) return result; } return null; }
        const item = record(value); if (!item) return null;
        if (Number(item.version) === 1 && Array.isArray(item.events) && item.page) return item;
        for (const child of Object.values(item)) { if (child && typeof child === "object") { const result = findRuntime(child, depth + 1); if (result) return result; } }
        return null;
    };
    const runtime = findRuntime(root);
    return {
        counts,
        confirmedBlank: blank,
        page: runtime?.page ? { blank: runtime.page.blank === true, bodyVisible: runtime.page.bodyVisible === true, visibleElementCount: Number(runtime.page.visibleElementCount || 0), bodyTextLength: Number(runtime.page.bodyTextLength || 0), readyState: String(runtime.page.readyState || "").slice(0, 20) } : null,
        criticalEvents: criticalEvents.slice(-8),
        warningEvents: warningEvents.slice(-4),
        renders: Array.isArray(runtime?.renders) ? runtime.renders.slice(-6).map((render: unknown) => { const item = record(render) || {}; return { elapsedMs: Number(item.elapsedMs || 0) || null, blank: item.blank === true, bodyVisible: item.bodyVisible === true, visibleElementCount: Number(item.visibleElementCount || 0), bodyTextLength: Number(item.bodyTextLength || 0) }; }) : [],
        omittedCriticalEvents: Math.max(0, criticalEvents.length - 8),
        omittedWarningEvents: Math.max(0, warningEvents.length - 4),
    };
}
export function compactPreviewIssueRuntime(runtime: unknown): Record<string, unknown> | null {
    const source = record(runtime); if (!source) return null; const events = collectEvents(source); const at = blankTime(source);
    const ranked = events.map(event => ({ event, critical: isCritical(event, source.confirmedBlank === true || hasConfirmedBlank(source), at) }));
    const critical = ranked.filter(entry => entry.critical); const warnings = ranked.filter(entry => !entry.critical).slice(-8);
    const selected = [...critical, ...warnings].slice(0, 20);
    return { version: Number(source.version || 0) || null, url: String(source.url || "").slice(0, 400), confirmedBlank: source.confirmedBlank === true,
        firstUsefulMs: Number(source.firstUsefulMs || 0) || null,
        page: source.page ? { blank: record(source.page)?.blank === true, bodyVisible: record(source.page)?.bodyVisible === true, visibleElementCount: Number(record(source.page)?.visibleElementCount || 0), bodyTextLength: Number(record(source.page)?.bodyTextLength || 0) } : null,
        events: selected.map(entry => entry.event), omittedErrorCount: Math.max(0, events.length - selected.length),
        renders: Array.isArray(source.renders) ? source.renders.slice(-8).map(render => { const item = record(render) || {}; return { elapsedMs: Number(item.elapsedMs || 0) || null, blank: item.blank === true, bodyVisible: item.bodyVisible === true, visibleElementCount: Number(item.visibleElementCount || 0), bodyTextLength: Number(item.bodyTextLength || 0) }; }) : [] };
}
