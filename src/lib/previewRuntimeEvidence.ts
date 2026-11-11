export type PreviewRuntimeEvidence = {
  version: 1;
  navigationId: string;
  startedAt: number;
  capturedAt: number;
  url: string;
  firstUsefulMs: number | null;
  confirmedBlank: boolean;
  page: Record<string, string | number | boolean | null>;
  events: Record<string, string | number | null>[];
  renders: Record<string, string | number | boolean | null>[];
};

function safeText(value: unknown, limit = 1200): string {
  return String(value || '').replace(/https?:\/\/[^\s"'<>)}\]]+/gi, value => {
    try {
      const position = value.match(/:\d+:\d+$/)?.[0] || '';
      const url = new URL(position ? value.slice(0, -position.length) : value);
      return `${url.origin}${url.pathname}${url.search ? '?' + [...new Set(url.searchParams.keys())].slice(0, 12).map(key => encodeURIComponent(key) + '=' + (url.searchParams.get(key) ? '[redacted]' : '')).join('&') : ''}${position}`;
    } catch { return '[invalid URL]'; }
  }).replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:token|secret|api[_-]?key|authorization|password)\s*[=:]\s*)(?!\[redacted\])[^\s&;,]+/gi, '$1[redacted]')
    .slice(0, limit);
}

// Project code and postMessage payloads are untrusted. Keep a bounded evidence
// schema, no DOM HTML, cookies, request bodies, or arbitrary object properties.
export function normalizePreviewRuntimeEvidence(value: unknown): PreviewRuntimeEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, any>;
  if (raw.version !== 1 || !raw.navigationId || !Number.isFinite(raw.startedAt) || !Number.isFinite(raw.capturedAt) || !raw.page) return null;
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null;
  const page = (v: Record<string, any>) => ({
    elapsedMs: number(v.elapsedMs), timestamp: safeText(v.timestamp, 32),
    blank: v.blank === true, bodyVisible: v.bodyVisible === true,
    readyState: safeText(v.readyState, 20), title: safeText(v.title, 160),
    bodyTextLength: number(v.bodyTextLength), visibleElementCount: number(v.visibleElementCount), mediaCount: number(v.mediaCount),
  });
  const result: PreviewRuntimeEvidence = {
    version: 1, navigationId: safeText(raw.navigationId, 100),
    startedAt: raw.startedAt, capturedAt: raw.capturedAt,
    url: safeText(raw.url, 500), firstUsefulMs: number(raw.firstUsefulMs), confirmedBlank: raw.confirmedBlank === true,
    page: page(raw.page),
    events: (Array.isArray(raw.events) ? raw.events : []).slice(-40).filter((v: unknown) => v && typeof v === 'object').map((v: any) => ({
      kind: safeText(v.kind, 30), timestamp: safeText(v.timestamp, 32), elapsedMs: number(v.elapsedMs),
      url: safeText(v.url, 500), message: safeText(v.message, 500), stack: safeText(v.stack, 1200),
      status: number(v.status), line: number(v.line), column: number(v.column), resourceType: safeText(v.resourceType, 30),
      method: safeText(v.method, 12),
    })),
    renders: (Array.isArray(raw.renders) ? raw.renders : []).slice(-24).filter((v: unknown) => v && typeof v === 'object').map(page),
  };
  // 20k UTF-16 characters fit within the 64k UTF-8 ingestion budget, even
  // for non-ASCII messages. Retain the newest errors and render transitions.
  while (JSON.stringify(result).length > 20_000 && result.events.length > 1) result.events.shift();
  while (JSON.stringify(result).length > 20_000 && result.renders.length > 2) result.renders.shift();
  return result;
}
