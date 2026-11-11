export interface PreviewBlockingOverlay {
  selector: string;
  position: string;
  zIndex: number;
  coverage: number;
  backgroundColor: string;
}

export interface PreviewInspectionResult {
  blank: boolean;
  title: string;
  bodyTextLength: number;
  visibleElementCount: number;
  blockingOverlay: PreviewBlockingOverlay | null;
  runtimeDiagnostics: PreviewRuntimeDiagnostic[];
}

export interface PreviewRuntimeDiagnostic {
  kind: string;
  resourceType?: string;
  method?: string;
  status?: number;
  url?: string;
  message?: string;
  stack?: string;
  line?: number | null;
  column?: number | null;
}

function safeDiagnosticUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const path = url.pathname.split('/').map((part) =>
      part.length > 64 || part.includes('@') ? '[redacted]' : part,
    ).join('/').slice(0, 240) || '/';
    return `${url.origin}${path}`.slice(0, 300);
  } catch {
    return '';
  }
}

function safeDiagnosticText(value: unknown): string {
  return String(value || '')
    .slice(0, 1000)
    .replace(/https?:\/\/[^\s"'<>)}\]]+/gi, (candidate) => {
      const locationSuffix = candidate.match(/:(\d+):(\d+)$/)?.[0] || '';
      const withoutLocation = locationSuffix ? candidate.slice(0, -locationSuffix.length) : candidate;
      return `${safeDiagnosticUrl(withoutLocation.replace(/[.,;:]$/, '')) || '[URL]'}${locationSuffix}`;
    })
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:token|secret|api[_-]?key|authorization|password)\s*[=:]\s*)[^\s&;,]+/gi, '$1[redacted]')
    .slice(0, 800);
}

export function compactPreviewBrowserFindings(rawInput: unknown): Record<string, unknown> | null {
  let parsed: Record<string, any> | null = null;
  if (typeof rawInput === 'string') {
    try { parsed = JSON.parse(rawInput); } catch { return null; }
  } else if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    parsed = rawInput as Record<string, any>;
  }
  if (!parsed) return null;
  const status = parsed.currentStatusData && typeof parsed.currentStatusData === 'object' ? parsed.currentStatusData : parsed;
  const startup = status.startupRuntimeWarningDetails && typeof status.startupRuntimeWarningDetails === 'object' ? status.startupRuntimeWarningDetails : {};
  const report = startup.diagnostics && typeof startup.diagnostics === 'object'
    ? startup.diagnostics
    : status.details && typeof status.details === 'object' ? status.details : {};
  const text = (value: unknown, max = 500) => safeDiagnosticText(value).slice(0, max);
  const entries = (value: unknown, fields: string[]) => (Array.isArray(value) ? value : []).slice(0, 6).map((entry: any) => {
    const compact: Record<string, unknown> = {};
    for (const field of fields) {
      if (entry?.[field] == null) continue;
      if (field === 'url') compact[field] = safeDiagnosticUrl(entry[field]);
      else if (field === 'location' && entry[field] && typeof entry[field] === 'object') {
        compact[field] = {
          url: safeDiagnosticUrl(entry[field].url),
          lineNumber: Number(entry[field].lineNumber || 0) || null,
          columnNumber: Number(entry[field].columnNumber || 0) || null,
        };
      } else compact[field] = typeof entry[field] === 'string' ? text(entry[field], field === 'stack' ? 500 : 400) : entry[field];
    }
    return compact;
  });
  const runtimeDiagnostics = Array.isArray(parsed.runtimeDiagnostics)
    ? parsed.runtimeDiagnostics
    : Array.isArray(report.runtimeDiagnostics) ? report.runtimeDiagnostics : [];
  const page = report.page && typeof report.page === 'object' ? report.page : null;
  return {
    reason: text(parsed.reason || startup.message || status.uiMessage, 240),
    navigation: report.navigation ? {
      status: Number(report.navigation.status || 0) || null,
      path: safeDiagnosticUrl(report.navigation.path || report.navigation.finalPath),
      error: text(report.navigation.error, 240),
    } : null,
    page: page ? {
      bodyVisible: page.bodyVisible === true,
      visibleElementCount: Number(page.visibleElementCount || 0),
      readyState: text(page.readyState, 24),
      largeOpaqueElements: entries(page.largeOpaqueElements, ['tag', 'width', 'height', 'position', 'zIndex', 'backgroundColor']).slice(0, 2),
    } : {
      visibleElementCount: Number(parsed.visibleElementCount || report.visibleElementCount || 0),
      blockingOverlay: parsed.blockingOverlay || report.blockingOverlay || null,
    },
    pageErrors: entries(report.pageErrors, ['message', 'stack']),
    consoleErrors: entries(report.consoleErrors, ['message', 'location']),
    httpErrors: entries(report.httpErrors, ['status', 'resourceType', 'url']),
    requestFailures: entries(report.requestFailures, ['resourceType', 'url', 'error']),
    blockedExternalRequests: entries(report.blockedExternalRequestDetails, ['url', 'resourceType', 'method', 'frameUrl']),
    blockedDynamicModuleErrors: entries(report.blockedDynamicModuleDetails, ['message', 'stack']),
    runtimeDiagnostics: entries(runtimeDiagnostics, ['kind', 'resourceType', 'method', 'status', 'url', 'message', 'stack', 'line', 'column']),
  };
}

export function getPreviewInspectionOrigin(previewUrl: string | null | undefined): string | null {
  try {
    const parsed = new URL(String(previewUrl || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function readPreviewInspectionResult(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  expected: { iframeWindow: Window | null; previewUrl: string | null; requestId: string; appId?: string },
): PreviewInspectionResult | null {
  const expectedOrigin = getPreviewInspectionOrigin(expected.previewUrl);
  if (!expectedOrigin || !expected.iframeWindow) return null;
  if (event.source !== expected.iframeWindow || event.origin !== expectedOrigin) return null;

  const message = event.data;
  if (!message || typeof message !== 'object' || message.type !== 'kloner:preview-inspection-result') return null;
  if (message.requestId !== expected.requestId || !message.result || typeof message.result !== 'object') return null;
  const correlation = message.correlation && typeof message.correlation === 'object' ? message.correlation as Record<string, unknown> : null;
  if (expected.appId && String(correlation?.app_id || '') !== expected.appId) return null;

  const raw = message.result as Record<string, unknown>;
  const rawOverlay = raw.blockingOverlay && typeof raw.blockingOverlay === 'object'
    ? raw.blockingOverlay as Record<string, unknown>
    : null;
  let blockingOverlay: PreviewBlockingOverlay | null = null;
  if (rawOverlay) {
    const selector = String(rawOverlay.selector || '').trim().slice(0, 180);
    const zIndex = Number(rawOverlay.zIndex);
    const coverage = Number(rawOverlay.coverage);
    if (selector && Number.isFinite(zIndex) && Number.isFinite(coverage)) {
      blockingOverlay = {
        selector,
        position: String(rawOverlay.position || '').slice(0, 24),
        zIndex,
        coverage: Math.max(0, Math.min(100, coverage)),
        backgroundColor: String(rawOverlay.backgroundColor || '').slice(0, 48),
      };
    }
  }

  const runtimeDiagnostics = (Array.isArray(raw.runtimeDiagnostics) ? raw.runtimeDiagnostics : [])
    .slice(0, 20)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry): PreviewRuntimeDiagnostic => {
      const status = Number(entry.status);
      const line = Number(entry.line);
      const column = Number(entry.column);
      return {
        kind: String(entry.kind || 'runtime_error').slice(0, 32),
        ...(entry.resourceType ? { resourceType: String(entry.resourceType).slice(0, 24) } : {}),
        ...(entry.method ? { method: String(entry.method).slice(0, 10) } : {}),
        ...(Number.isFinite(status) && status >= 0 && status <= 599 ? { status } : {}),
        ...(entry.url ? { url: safeDiagnosticUrl(entry.url) } : {}),
        ...(entry.message ? { message: safeDiagnosticText(entry.message) } : {}),
        ...(entry.stack ? { stack: safeDiagnosticText(entry.stack) } : {}),
        ...(Number.isFinite(line) && line > 0 ? { line } : {}),
        ...(Number.isFinite(column) && column > 0 ? { column } : {}),
      };
    });

  return {
    blank: raw.blank === true,
    title: String(raw.title || '').slice(0, 160),
    bodyTextLength: Math.max(0, Number(raw.bodyTextLength) || 0),
    visibleElementCount: Math.max(0, Number(raw.visibleElementCount) || 0),
    blockingOverlay,
    runtimeDiagnostics,
  };
}
