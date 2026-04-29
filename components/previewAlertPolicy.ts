export const PREVIEW_ALERT_DEDUPE_TTL_MS = 5 * 60 * 1000;

const HARD_FAILURE_TIMEOUT_REASONS = new Set([
  'machine_disk_io_error',
  'machine_retries_exhausted',
  'machine_create_failed',
  'machine_create_timeout',
  'fly_machine_create_timeout',
  'compile_error',
]);

const RECOVERABLE_STATES = new Set([
  'pending',
  'starting',
  'booting',
  'creating_machine',
  'creating_server',
  'restarting',
  'app_generation_not_ready',
  'proxy_unreachable',
  'proxy_unreachable_auto',
]);

const UNRECOVERABLE_STATES = new Set([
  'error',
  'failed',
  'fatal',
  'compile_error',
]);

export type BackendSignalSummary = {
  status: string;
  uiStage: string;
  timeoutReason: string;
  requestId?: string;
  jobId?: string;
  hardFailure: boolean;
  recoverable: boolean;
};

export type PreviewPresentationState = {
  status: string;
  uiStage: string;
  ready: boolean;
  attachable: boolean;
  hasMachineId: boolean;
  hasPreviewUrl: boolean;
  restartPending: boolean;
  retryable: boolean;
  terminal: boolean;
  recoverable: boolean;
  shouldKeepPolling: boolean;
  shouldShowLivePreview: boolean;
  shouldShowLoadingShell: boolean;
  shouldShowTerminalError: boolean;
};

export function parsePreviewTimeoutMs(raw: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(String(raw || '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallbackMs;
  return Math.max(5_000, parsed);
}

export function classifyBackendSignal(statusData: any): BackendSignalSummary {
  const status = String(statusData?.status || '').trim().toLowerCase();
  const uiStage = String(statusData?.uiStage || '').trim().toLowerCase();
  const timeoutReason = String(statusData?.debug?.timeoutReason || statusData?.timeoutReason || '').trim().toLowerCase();
  const requestId = String(
    statusData?.requestId ||
      statusData?.reqId ||
      statusData?.debug?.requestId ||
      statusData?.debug?.reqId ||
      ''
  ).trim() || undefined;
  const jobId = String(statusData?.jobId || statusData?.debug?.jobId || '').trim() || undefined;

  const recoverableState =
    RECOVERABLE_STATES.has(status) ||
    RECOVERABLE_STATES.has(uiStage) ||
    (!status || status === 'pending' || status === 'transitioning');

  const hardFailure =
    HARD_FAILURE_TIMEOUT_REASONS.has(timeoutReason) ||
    ((UNRECOVERABLE_STATES.has(status) || UNRECOVERABLE_STATES.has(uiStage)) && !recoverableState);

  const recoverable = recoverableState && !HARD_FAILURE_TIMEOUT_REASONS.has(timeoutReason);

  return {
    status,
    uiStage,
    timeoutReason,
    requestId,
    jobId,
    hardFailure,
    recoverable,
  };
}

export function isTrustedBrowserPreviewUrl(url: string, origin?: string | null): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;

  const proxyPathPattern = /^\/api\/(?:webcontainer|preview)\/[^\s?#]+/i;
  if (proxyPathPattern.test(raw)) return true;

  try {
    const base = origin || (typeof window !== 'undefined' ? window.location.origin : undefined);
    const parsed = new URL(raw, base);
    if (!base || parsed.origin !== base) return false;
    return proxyPathPattern.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function classifyPreviewPresentationState(statusData: any, opts?: {
  previewUrl?: string | null;
  iframeLoaded?: boolean;
  hmrWsStatus?: 'unknown' | 'ok' | 'blocked';
  externalPreviewMode?: boolean;
  origin?: string | null;
}): PreviewPresentationState {
  const status = String(statusData?.status || '').trim().toLowerCase();
  const uiStage = String(statusData?.uiStage || '').trim().toLowerCase();
  const ready = Boolean(statusData?.ready);
  const attachable = Boolean(statusData?.attachable);
  const machineId = String(statusData?.machineId || statusData?.machine?.id || '').trim();
  const hasMachineId = Boolean(machineId);
  const hasPreviewUrl = Boolean(String(opts?.previewUrl || '').trim());
  const restartPending = Boolean(statusData?.restartPending || statusData?.queued || statusData?.outcome === 'restart_pending');
  const retryable = Boolean(statusData?.retryable || statusData?.retryAfterSeconds != null);
  const backendSignal = classifyBackendSignal(statusData);

  const terminalStatus = new Set(['error', 'failed', 'fatal', 'stopped', 'cancelled', 'canceled', 'timeout']);
  const transitionalStatus = new Set(['pending', 'starting', 'booting', 'creating_machine', 'creating_server', 'transitioning', 'restarting']);
  const connectableStatus = new Set(['ready', 'running', 'compiled', 'started', 'completed', 'finished', 'active', 'online']);
  const terminal = (terminalStatus.has(status) || terminalStatus.has(uiStage)) && !backendSignal.recoverable && !restartPending && !retryable;
  const recoverable = Boolean(
    restartPending ||
      retryable ||
      backendSignal.recoverable ||
      transitionalStatus.has(status) ||
      transitionalStatus.has(uiStage) ||
      (hasMachineId && hasPreviewUrl && !terminal),
  );

  const bootingLike = transitionalStatus.has(status) || transitionalStatus.has(uiStage);
  const shouldShowLivePreview = Boolean(
    opts?.externalPreviewMode ||
      ready ||
      attachable ||
      opts?.iframeLoaded ||
      opts?.hmrWsStatus === 'ok' ||
      (connectableStatus.has(status) && !terminal) ||
      (recoverable && !bootingLike && hasMachineId && hasPreviewUrl),
  );

  return {
    status,
    uiStage,
    ready,
    attachable,
    hasMachineId,
    hasPreviewUrl,
    restartPending,
    retryable,
    terminal,
    recoverable,
    shouldKeepPolling: !terminal && !attachable && (recoverable || !ready),
    shouldShowLivePreview,
    shouldShowLoadingShell: !shouldShowLivePreview,
    shouldShowTerminalError: terminal,
  };
}

export function buildPreviewAlertKey(args: {
  userId?: string | null;
  appId: string;
  code?: string | null;
  reason?: string | null;
}): string {
  const userId = String(args.userId || 'anonymous').trim() || 'anonymous';
  const appId = String(args.appId || 'unknown-app').trim() || 'unknown-app';
  const code = String(args.code || 'unknown-code').trim() || 'unknown-code';
  const reason = String(args.reason || 'unknown-reason').trim().toLowerCase() || 'unknown-reason';
  return `${userId}:${appId}:${code}:${reason}`;
}

export function getPollBackoffMs(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 1000;
  return Math.min(8000, 1000 * (2 ** (consecutiveFailures - 1)));
}

export function shouldDedupeAlert(cache: Record<string, number>, key: string, nowMs: number, ttlMs = PREVIEW_ALERT_DEDUPE_TTL_MS): boolean {
  const last = cache[key];
  if (typeof last !== 'number') return false;
  return nowMs - last < ttlMs;
}
