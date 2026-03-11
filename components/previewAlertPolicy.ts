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
  'starting',
  'booting',
  'restarting',
  'app_generation_not_ready',
  'proxy_unreachable',
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

  const hardFailure =
    HARD_FAILURE_TIMEOUT_REASONS.has(timeoutReason) ||
    UNRECOVERABLE_STATES.has(status) ||
    UNRECOVERABLE_STATES.has(uiStage);

  const recoverable =
    RECOVERABLE_STATES.has(status) ||
    RECOVERABLE_STATES.has(uiStage) ||
    (!hardFailure && (!status || status === 'pending' || status === 'transitioning'));

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
