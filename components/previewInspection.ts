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
  runtime?: PreviewRuntimeEvidence;
}

export function readPreviewRuntimeState(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  expected: { iframeWindow: Window | null; previewUrl: string | null; appId: string; code: string },
): PreviewRuntimeEvidence | null {
  const origin = getPreviewInspectionOrigin(expected.previewUrl);
  if (!origin || !expected.iframeWindow || event.source !== expected.iframeWindow || event.origin !== origin) return null;
  const data = event.data;
  if (data?.type !== 'kloner:preview-runtime-state' || data.correlation?.app_id !== expected.appId
    || data.correlation?.preview_code !== expected.code) return null;
  const runtime = normalizePreviewRuntimeEvidence(data.runtime);
  if (!runtime || getPreviewInspectionOrigin(runtime.url) !== origin || runtime.capturedAt < runtime.startedAt
    || Math.abs(Date.now() - runtime.capturedAt) > 120_000) return null;
  return runtime;
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
  expected: { iframeWindow: Window | null; previewUrl: string | null; requestId: string },
): PreviewInspectionResult | null {
  const expectedOrigin = getPreviewInspectionOrigin(expected.previewUrl);
  if (!expectedOrigin || !expected.iframeWindow) return null;
  if (event.source !== expected.iframeWindow || event.origin !== expectedOrigin) return null;

  const message = event.data;
  if (!message || typeof message !== 'object' || message.type !== 'kloner:preview-inspection-result') return null;
  if (message.requestId !== expected.requestId || !message.result || typeof message.result !== 'object') return null;

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

  return {
    blank: raw.blank === true,
    title: String(raw.title || '').slice(0, 160),
    bodyTextLength: Math.max(0, Number(raw.bodyTextLength) || 0),
    visibleElementCount: Math.max(0, Number(raw.visibleElementCount) || 0),
    blockingOverlay,
    ...(normalizePreviewRuntimeEvidence(raw.runtime) ? { runtime: normalizePreviewRuntimeEvidence(raw.runtime)! } : {}),
  };
}
import { normalizePreviewRuntimeEvidence, type PreviewRuntimeEvidence } from '../src/lib/previewRuntimeEvidence';
