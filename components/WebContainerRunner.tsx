// components/WebContainerRunner.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { db } from "@/lib/firebase";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";
import { useAuth } from "@/src/hooks/useAuth";
import {
  buildPreviewAlertKey,
  classifyBackendSignal,
  classifyPreviewPresentationState,
  getPollBackoffMs,
  parsePreviewTimeoutMs,
  PREVIEW_ALERT_DEDUPE_TTL_MS,
  isTrustedBrowserPreviewUrl,
  shouldDedupeAlert,
} from './previewAlertPolicy';
import {
  canShowPreviewFixWithAi,
  mapPreviewRecommendedActionLabel,
  normalizePreviewGenerationContract,
  mapPreviewUserActionLabel,
  normalizePreviewFailureContract,
  type PreviewFailureContract,
  type PreviewFailureUserAction,
} from './previewFailureContract';

const getStoredContainerCode = async (appId: string, user: any): Promise<string | null> => {
  try {
    const stored = localStorage.getItem(`webcontainer_${appId}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.code && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
        return parsed.code;
      }
    }
  } catch {
    // Ignore localStorage errors
  }

  try {
    if (user?.uid) {
      const docRef = doc(db, 'kloner_users', user.uid, 'kloner_apps', appId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data?.containerCode && data?.containerCodeTimestamp && Date.now() - data.containerCodeTimestamp < 24 * 60 * 60 * 1000) {
          try {
            localStorage.setItem(
              `webcontainer_${appId}`,
              JSON.stringify({ code: data.containerCode, timestamp: data.containerCodeTimestamp })
            );
          } catch {
            // Ignore localStorage errors
          }
          return data.containerCode;
        }
      }
    }
  } catch (error) {
    console.error('Failed to check Firebase for container code:', error);
  }

  return null;
};

const storeContainerCode = async (appId: string, code: string, user: any) => {
  try {
    localStorage.setItem(`webcontainer_${appId}`, JSON.stringify({ code, timestamp: Date.now() }));
  } catch {
    // Ignore storage errors
  }

  try {
    if (user?.uid) {
      const docRef = doc(db, 'kloner_users', user.uid, 'kloner_apps', appId);
      await updateDoc(docRef, {
        containerCode: code,
        containerCodeTimestamp: Date.now(),
        updatedAt: new Date(),
      });
    }
  } catch (error) {
    console.error('Failed to store container code in Firebase:', error);
  }
};

const clearStoredContainerCode = (appId: string) => {
  try {
    localStorage.removeItem(`webcontainer_${appId}`);
  } catch {
    // Ignore storage errors
  }
};

const clearStoredContainerCodeEverywhere = async (appId: string, user: any) => {
  clearStoredContainerCode(appId);
  try {
    if (user?.uid) {
      const docRef = doc(db, 'kloner_users', user.uid, 'kloner_apps', appId);
      await updateDoc(docRef, {
        containerCode: null,
        containerCodeTimestamp: null,
        updatedAt: new Date(),
      });
    }
  } catch (error) {
    console.error('Failed to clear container code in Firebase:', error);
  }
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asFiniteInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRetryAfterSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.ceil(value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.ceil(parsed));
    }
  }
  return null;
}

function asBooleanIfPresent(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  return null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asTrimmedString(value);
    if (text) return text;
  }
  return null;
}

function normalizePreviewFailureDetails(rawStatusData: any) {
  const backend = asRecord(rawStatusData);
  const diagnostic = asRecord(backend?.diagnostic);
  const previewFailure = asRecord(backend?.previewFailure);
  const backendDebug = asRecord(backend?.debug);
  const machine = asRecord(backendDebug?.machine || backend?.machine || previewFailure?.machine || diagnostic?.machine);

  const requestId = pickFirstString(
    backend?.requestId,
    backend?.reqId,
    backendDebug?.requestId,
    backendDebug?.reqId,
    diagnostic?.requestId,
    diagnostic?.reqId,
    previewFailure?.requestId,
    previewFailure?.reqId,
  );
  const correlationId = pickFirstString(
    backend?.correlationId,
    backend?.traceId,
    backend?.spanId,
    backend?.requestCorrelationId,
    backendDebug?.correlationId,
    backendDebug?.traceId,
    backendDebug?.spanId,
    diagnostic?.correlationId,
    diagnostic?.traceId,
    diagnostic?.spanId,
    previewFailure?.correlationId,
    previewFailure?.traceId,
    previewFailure?.spanId,
  );

  const backendStatus = pickFirstString(
    backend?.backendStatus,
    backend?.status,
    diagnostic?.backendStatus,
    diagnostic?.status,
    previewFailure?.backendStatus,
    previewFailure?.status,
    backendDebug?.status,
  );
  const uiStage = pickFirstString(
    backend?.uiStage,
    diagnostic?.uiStage,
    previewFailure?.uiStage,
    backendDebug?.uiStage,
  );
  const timeoutReason = pickFirstString(
    backend?.timeoutReason,
    backendDebug?.timeoutReason,
    diagnostic?.timeoutReason,
    previewFailure?.timeoutReason,
  );
  const machineState = pickFirstString(
    backend?.machineState,
    backend?.machine?.state,
    machine?.state,
    backendDebug?.machineState,
    backendDebug?.machine?.state,
    diagnostic?.machineState,
    diagnostic?.machine?.state,
    previewFailure?.machineState,
    previewFailure?.machine?.state,
  );
  const restartCount = asFiniteInteger(
    backend?.restartCount ??
      backend?.machine?.restartCount ??
      machine?.restartCount ??
      backendDebug?.restartCount ??
      backendDebug?.machine?.restartCount ??
      diagnostic?.restartCount ??
      diagnostic?.machine?.restartCount ??
      previewFailure?.restartCount ??
      previewFailure?.machine?.restartCount,
  );
  const rootfsIoCorruption = asBooleanIfPresent(
    backend?.rootfsIoCorruption ??
      backend?.storage?.rootfsIoCorruption ??
      backendDebug?.rootfsIoCorruption ??
      backendDebug?.storage?.rootfsIoCorruption ??
      diagnostic?.rootfsIoCorruption ??
      diagnostic?.storage?.rootfsIoCorruption ??
      previewFailure?.rootfsIoCorruption ??
      previewFailure?.storage?.rootfsIoCorruption,
  );

  const suggestedFix = pickFirstString(
    backend?.suggestedFix,
    diagnostic?.suggestedFix,
    previewFailure?.suggestedFix,
  );

  const uiTitle = pickFirstString(
    backend?.uiTitle,
    previewFailure?.uiTitle,
    diagnostic?.uiTitle,
  );
  const uiMessage = pickFirstString(
    backend?.uiMessage,
    previewFailure?.uiMessage,
    diagnostic?.uiMessage,
    backend?.message,
    previewFailure?.message,
    diagnostic?.message,
  );

  const correlationIds: Array<{ label: string; value: string }> = [];
  const pushCorrelation = (label: string, value: unknown) => {
    const text = asTrimmedString(value);
    if (text && !correlationIds.some((entry) => entry.value === text)) {
      correlationIds.push({ label, value: text });
    }
  };

  pushCorrelation('correlationId', backend?.correlationId || backendDebug?.correlationId || diagnostic?.correlationId || previewFailure?.correlationId);
  pushCorrelation('traceId', backend?.traceId || backendDebug?.traceId || diagnostic?.traceId || previewFailure?.traceId);
  pushCorrelation('spanId', backend?.spanId || backendDebug?.spanId || diagnostic?.spanId || previewFailure?.spanId);
  pushCorrelation('jobId', backend?.jobId || backendDebug?.jobId || diagnostic?.jobId || previewFailure?.jobId);
  pushCorrelation('machineId', backend?.machineId || backend?.machine?.id || machine?.id || backendDebug?.machineId || diagnostic?.machineId || previewFailure?.machineId);

  const stalePreviewCode =
    backend?.__httpStatus === 410 ||
    backend?.httpStatus === 410 ||
    backend?.statusCode === 410 ||
    backendStatus === 'gone' ||
    backendStatus === 'expired' ||
    uiStage === 'preview_replaced_or_deleted';

  return {
    backend,
    diagnostic,
    previewFailure,
    requestId,
    correlationId,
    correlationIds,
    backendStatus,
    uiStage,
    timeoutReason,
    machineState,
    restartCount,
    rootfsIoCorruption,
    suggestedFix,
    uiTitle,
    uiMessage,
    stalePreviewCode,
  };
}

function formatPreviewFailureSection(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

// React 18 StrictMode in dev intentionally mounts/unmounts twice.
// If we eagerly stop the local runner on unmount, we create a start/stop/start loop.
// This small scheduler avoids killing the process when a remount happens immediately.
const pendingCleanupTimers = new Map<string, number>();

interface WebContainerRunnerProps {
  appId: string;
  files: { [path: string]: { content: string; lastModified: number } };
  previewIssue?: string | null;
  filesReady?: boolean;
  onFileChange?: (path: string, content: string) => void;
  onPreviewReadyChange?: (ready: boolean) => void;
  onPreviewIssueChange?: (issue: {
    issue: string | null;
    diagnostics?: string | null;
    failure?: PreviewFailureContract | null;
    recommendedActionLabel?: string | null;
  } | null) => void;
  onBackendReady?: (args: { appId: string; code: string; url: string }) => void;
  onRequestRebuild?: () => void | Promise<void>;
  reloadToken?: number;
  applyToken?: number;
  restartToken?: number;
  reconnectToken?: number;
  forceFreshStart?: number;
  pollingConfig?: {
    // Default is the existing behavior (30 retries, ~5 minutes).
    // Use this only for long-running generated builds.
    maxPollingRetries?: number;
    maxContainerNotFound?: number;
  };
  onCompileErrorFixRequest?: (payload: {
    appId: string;
    code: string;
    actionType: 'quick_fix_compile';
    fixAction?: string;
    autoSend?: boolean;
    compileError: {
      summary: string;
      detail: string;
      fingerprint: string;
    };
  }) => void;
  debugPreviewScenario?: { mode: 'terminal-error' | 'terminal-error-auto-fix'; nonce: number } | null;
  navigatePath?: string | null;
  navigatePathToken?: number;
  onNavigatePathChange?: (path: string | null) => void;
}

export default function WebContainerRunner({ appId, files, filesReady = true, onFileChange, onPreviewReadyChange, onPreviewIssueChange, onBackendReady, onRequestRebuild, onCompileErrorFixRequest, debugPreviewScenario, reloadToken, applyToken, restartToken, reconnectToken, forceFreshStart, pollingConfig, navigatePath, navigatePathToken, onNavigatePathChange }: WebContainerRunnerProps) {

  type DebugEvent = {
    ts: number;
    kind: string;
    data?: any;
  };

  const debugEventsRef = useRef<DebugEvent[]>([]);
  const debugPersistTimerRef = useRef<number | null>(null);
  const debugKeyRef = useRef<string>(`kloner.appprevieweditor.aiAgentEvents.${String(appId || 'unknown')}`);

  const redactDebugValue = (value: unknown, depth = 0): unknown => {
    if (depth > 4) return '[redacted]';
    if (value == null) return value;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactDebugValue(item, depth + 1));

    const record = value as Record<string, unknown>;
    const sensitiveKeys = new Set([
      'previewUrl',
      'url',
      'statusUrl',
      'machineId',
      'requestId',
      'jobId',
      'idempotencyKey',
      'csrf',
      'authorization',
      'auth',
      'token',
      'signedArchiveUrl',
      'archiveUrl',
      'privateIp',
      'privateIP',
      'ip',
      'headers',
      'cookies',
    ]);

    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(record)) {
      const normalizedKey = key.trim().toLowerCase();
      if (sensitiveKeys.has(key) || sensitiveKeys.has(normalizedKey)) {
        next[key] = '[redacted]';
        continue;
      }
      next[key] = redactDebugValue(nestedValue, depth + 1);
    }
    return next;
  };

  const schedulePersistDebugEvents = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (debugPersistTimerRef.current != null) return;
    debugPersistTimerRef.current = window.setTimeout(() => {
      debugPersistTimerRef.current = null;
      try {
        const key = debugKeyRef.current;
        const payload = JSON.stringify(debugEventsRef.current.slice(-500).map((event) => ({
          ...event,
          data: redactDebugValue(event.data),
        })));
        window.localStorage.setItem(key, payload);
        (window as any).__klonerAppPreviewEditorAiAgentEvents = (window as any).__klonerAppPreviewEditorAiAgentEvents || {};
        (window as any).__klonerAppPreviewEditorAiAgentEvents[String(appId || 'unknown')] = debugEventsRef.current.slice(-500).map((event) => ({
          ...event,
          data: redactDebugValue(event.data),
        }));
      } catch {
        // ignore
      }
    }, 250);
  }, [appId]);

  const recordDebugEvent = useCallback((kind: string, data?: any) => {
    const ts = Date.now();
    const safeData = (() => {
      try {
        if (data == null) return undefined;
        // Prevent unbounded storage growth on accidental large payloads.
        const json = JSON.stringify(data);
        if (json.length <= 20_000) return data;
        return { truncated: true, bytes: json.length, preview: json.slice(0, 20_000) };
      } catch {
        return { unserializable: true };
      }
    })();

    debugEventsRef.current.push({ ts, kind, data: redactDebugValue(safeData) });
    if (debugEventsRef.current.length > 600) {
      debugEventsRef.current = debugEventsRef.current.slice(-500);
    }
    schedulePersistDebugEvents();
  }, [schedulePersistDebugEvents]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    debugKeyRef.current = `kloner.appprevieweditor.aiAgentEvents.${String(appId || 'unknown')}`;
    try {
      const raw = window.localStorage.getItem(debugKeyRef.current);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          debugEventsRef.current = parsed.slice(-500);
        }
      }
    } catch {
      // ignore
    }
  }, [appId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onAiAgentEvent = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent<any>)?.detail || {};
        recordDebugEvent('ai-agent', detail);
      } catch {
        // ignore
      }
    };

    window.addEventListener('kloner:ai-agent-event', onAiAgentEvent as EventListener);
    recordDebugEvent('ai-agent-recorder-ready', { appId });
    return () => {
      window.removeEventListener('kloner:ai-agent-event', onAiAgentEvent as EventListener);
    };
  }, [appId, recordDebugEvent]);
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [showPreviewUrlOverlay, setShowPreviewUrlOverlay] = useState(true);
  const [previewUrlDetailsOpen, setPreviewUrlDetailsOpen] = useState(false);
  const [showHmrWarning, setShowHmrWarning] = useState(true);
  const [hmrWsStatus, setHmrWsStatus] = useState<'unknown' | 'ok' | 'blocked'>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [compileErrorState, setCompileErrorState] = useState<{
    code: string;
    summary: string;
    detail: string;
    fingerprint: string;
    quickFixEligible: boolean;
    actionType: 'quick_fix_compile';
    fixAction?: string;
    userAction: PreviewFailureUserAction;
    canShowFixWithAiCta: boolean;
  } | null>(null);
  const compileFixRequestCooldownRef = useRef<{ fingerprint: string; until: number } | null>(null);
  const fixWithAiCooldownTimerRef = useRef<number | null>(null);
  const [fixWithAiCooldownUntil, setFixWithAiCooldownUntil] = useState(0);
  const [cookieRecoveryPromptVisible, setCookieRecoveryPromptVisible] = useState(false);
  const [externalPreviewMode, setExternalPreviewMode] = useState(false);
  const [externalPreviewAutoOpenFailed, setExternalPreviewAutoOpenFailed] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [startAttempt, setStartAttempt] = useState(0);
  const [manualStartNonce, setManualStartNonce] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isApplyRefreshing, setIsApplyRefreshing] = useState(false);
  const [pollNetworkWarning, setPollNetworkWarning] = useState<string | null>(null);
  const [currentStatusData, setCurrentStatusData] = useState<any>(null); // Store latest status data for UI
  const [connectingToExisting, setConnectingToExisting] = useState(false); // Track if connecting to existing machine
  const lastDebugPreviewScenarioRef = useRef<string>('');
  // Prevent duplicate starts for the *same* set of inputs. This avoids the
  // original "start/stop" thrash bug while still allowing reconnect/retry tokens.
  const lastStartKeyRef = useRef<string | null>(null);
  const maxRetries = 2; // Reduced from 3 to be less aggressive
  const maxPollingRetriesRaw =
    typeof pollingConfig?.maxPollingRetries === 'number'
      ? pollingConfig.maxPollingRetries
      : 480; // default: up to ~12 minutes of polling at 1.5s/tick
  // Enforce a minimum aligned with the 12-minute hard timeout.
  const maxPollingRetries = Math.max(480, maxPollingRetriesRaw);
  const pollingRetryCountRef = useRef(0); // Track polling retry attempts
  const retryScheduledRef = useRef(false);
  const totalAttemptsRef = useRef(0); // Circuit breaker for infinite retries
  const maxTotalAttempts = 10; // Absolute maximum attempts across all retries (increased from 5)
  const assetFailureCountRef = useRef(0); // Track 404s for static assets
  const maxAssetFailures = 3; // Stop auto-retrying after this many asset 404s
  const containerNotFoundCountRef = useRef(0); // Track 404s for container status
  const maxContainerNotFound =
    typeof pollingConfig?.maxContainerNotFound === 'number'
      ? pollingConfig.maxContainerNotFound
      : 5; // default: give up after this many container 404s
  const appLoadedSuccessfullyRef = useRef(false); // Track if app server is successfully loaded
  const iframeLoadedSuccessfullyRef = useRef(false); // Track if iframe loaded successfully
  const lastForceFreshStartRef = useRef<number>(0);
  const pollingCodeRef = useRef<string | null>(null); // Track the current polling code
  const activePollCodeRef = useRef<string | null>(null); // Latest code that should be polled; stale poll loops must bail
  const previewRegistrationGraceUntilRef = useRef<number>(0); // Allow extra registration time for brand-new machines
  const backendReadyRef = useRef(false); // Backend contract: `ready === true` is authoritative
  const lastUiStageRef = useRef<string>('');
  const lastStatusRef = useRef<string>('');
  const statusPollTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track status polling timeout
  const iframeLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track iframe load timeout
  const iframeCriticalTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const iframePostLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Detect white-screen after iframe navigation
  const automaticRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track automatic retry timeout
  const pollStartedAtRef = useRef<number>(0);
  const latestDeploymentUrlRef = useRef<string>('');
  const hubStatusUrlRef = useRef<string | null>(null);
  const lastReportedStatusRef = useRef<string>('');
  const lastReadyUrlRef = useRef<string | null>(null);
  const lastBackendReadyNotifyRef = useRef<string | null>(null);
  const lastPreviewGenerationKeyRef = useRef<string>('');
  const autoRebuildByCodeRef = useRef<Record<string, true>>({});
  const compileErrorSeenByFingerprintRef = useRef<Record<string, true>>({});
  const compileErrorActiveFingerprintRef = useRef<string | null>(null);
  const iframePostLoadRecoveryCountRef = useRef<number>(0);
  const noMachineBootSinceRef = useRef<number | null>(null);
  const pollFetchFailureCountRef = useRef(0);
  const pollRateLimitCountRef = useRef(0);
  const lastPollFailureSignatureRef = useRef('');
  const repeatedPollFailureCountRef = useRef(0);
  const lastPollIssueReportKeyRef = useRef<string>('');
  const lastAppServerKindRef = useRef<'fallback' | 'next-dev' | 'next-prod' | ''>('');
  const stickyProgressByCodeRef = useRef<Record<string, number>>({});
  const lastTimeoutReportKeyRef = useRef<string>('');
  const lastBackendStatusRef = useRef<any>(null);
  const lastPreviewIssueEmitSignatureRef = useRef<string>('');
  const iframeWarnContextRef = useRef<{ key: string; code: string; previewUrl: string; warnedAt: number } | null>(null);
  const previewActionThrottleRef = useRef<{ refreshAt: number; rebuildAt: number }>({
    refreshAt: 0,
    rebuildAt: 0,
  });

  const PREVIEW_IFRAME_WARN_MS = parsePreviewTimeoutMs(
    process.env.NEXT_PUBLIC_PREVIEW_IFRAME_WARN_MS || process.env.PREVIEW_IFRAME_WARN_MS,
    30_000,
  );
  const PREVIEW_IFRAME_CRITICAL_MS = Math.max(
    PREVIEW_IFRAME_WARN_MS + 5_000,
    parsePreviewTimeoutMs(
      process.env.NEXT_PUBLIC_PREVIEW_IFRAME_CRITICAL_MS || process.env.PREVIEW_IFRAME_CRITICAL_MS,
      120_000,
    ),
  );

  // Default status polling interval while the preview is booting/compiling.
  // We keep this relatively infrequent; readiness is primarily driven by the
  // preview URL/iframe once available.
  const POLL_INTERVAL_MS = 10_000;

  // Throttle: regardless of code path, never issue status checks more frequently
  // than this (prevents duplicate loops and tight retry paths from spamming).
  const MIN_STATUS_FETCH_INTERVAL_MS = 2_000;
  const lastStatusFetchAtRef = useRef<number>(0);
  const HARD_POLL_TIMEOUT_MS = 12 * 60 * 1000;

  const parseRetryAfterMs = (value: string | null): number | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const numericSeconds = Number(raw);
    if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
      return Math.max(0, Math.round(numericSeconds * 1000));
    }

    const untilMs = Date.parse(raw);
    if (!Number.isFinite(untilMs)) return null;
    return Math.max(0, untilMs - Date.now());
  };

  const DEFAULT_HUB_HOST = 'tracksite-hub.fly.dev';
  const CUSTOM_PREVIEW_HOST = String(process.env.NEXT_PUBLIC_PREVIEW_HOST || 'preview.kloner.app').trim().toLowerCase();
  const CANONICAL_PREVIEW_ORIGIN = `https://${CUSTOM_PREVIEW_HOST || DEFAULT_HUB_HOST}`;
  const CANONICAL_API_ORIGIN = String(process.env.NEXT_PUBLIC_PREVIEW_API_ORIGIN || 'https://www.kloner.app')
    .trim()
    .replace(/\/+$/, '');
  const HUB_HOSTS = new Set([DEFAULT_HUB_HOST, CUSTOM_PREVIEW_HOST].filter(Boolean));

  const isHubHost = (host: string): boolean => HUB_HOSTS.has(String(host || '').toLowerCase());

  const normalizePreviewUrlHost = (maybeUrl: string): string => {
    const raw = String(maybeUrl || '').trim();
    if (!raw) return raw;
    if (raw.startsWith('/')) return raw;

    try {
      const u = new URL(raw);
      if (u.hostname.toLowerCase() === DEFAULT_HUB_HOST && CUSTOM_PREVIEW_HOST && CUSTOM_PREVIEW_HOST !== DEFAULT_HUB_HOST) {
        u.hostname = CUSTOM_PREVIEW_HOST;
      }
      return u.toString();
    } catch {
      return raw;
    }
  };

  const isHubPreviewUrl = (url: string): boolean => {
    const normalized = normalizePreviewUrlHost(url);
    try {
      const u = new URL(normalized, typeof window !== 'undefined' ? window.location.origin : undefined);
      const parts = u.pathname.split('/').filter(Boolean);
      return isHubHost(u.hostname.toLowerCase()) && parts.length >= 2 && parts[0] === 'preview' && Boolean(parts[1]);
    } catch {
      return false;
    }
  };

  const buildBrowserPreviewUrl = (candidate?: string | null): string => {
    const proxyRootPath = `/api/webcontainer/${encodeURIComponent(appId)}/proxy/`;
    const raw = normalizePreviewUrlHost(String(candidate || ''));

    // Always prefer canonical hosted preview URLs when available.
    if (isHubPreviewUrl(raw)) {
      try {
        const u = new URL(raw);
        return `${CANONICAL_PREVIEW_ORIGIN}${u.pathname}${u.search}${u.hash}`;
      } catch {
        return raw;
      }
    }

    // For proxy routes, avoid local-origin relative URLs in local frontend.
    try {
      const parsed = new URL(raw || proxyRootPath, typeof window !== 'undefined' ? window.location.origin : CANONICAL_API_ORIGIN);
      const proxyPathPattern = /^\/api\/(?:webcontainer|preview)\/[\s\S]*/i;
      if (proxyPathPattern.test(parsed.pathname)) {
        return `${CANONICAL_API_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // fall through to deterministic canonical proxy root
    }

    return `${CANONICAL_API_ORIGIN}${proxyRootPath}`;
  };

  const derivePreviewCodeFromUrl = (url: string): string | null => {
    try {
      const normalized = normalizePreviewUrlHost(url);
      const u = new URL(normalized, typeof window !== 'undefined' ? window.location.origin : undefined);
      // Hub URLs look like: https://<hub-host>/preview/<code>?t=<token>
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0] === 'preview') {
        const code = String(parts[1] || '').trim();
        if (code) return code;
      }
      return null;
    } catch {
      return null;
    }
  };

  const isValidPreviewUrlCandidate = (maybeUrl: string): boolean => {
    const raw = normalizePreviewUrlHost(maybeUrl);
    if (!raw) return false;

    if (isHubPreviewUrl(raw)) return true;

    return isTrustedBrowserPreviewUrl(raw, typeof window !== 'undefined' ? window.location.origin : undefined);
  };

  const requestForceFreshRebuild = (reason: string, previewUrl: string) => {
    if (typeof window === 'undefined') return;
    const code = pollingCodeRef.current || derivePreviewCodeFromUrl(previewUrl) || 'unknown';
    if (autoRebuildByCodeRef.current[code]) return;
    autoRebuildByCodeRef.current[code] = true;

    console.warn('[WebContainerRunner] Auto-rebuild requested', { appId, reason, code });
    try {
      window.dispatchEvent(
        new CustomEvent('kloner:preview-force-fresh', {
          detail: { appId, reason, code },
        })
      );
    } catch {
      // ignore
    }
  };

  const shouldShowInternalPreviewDetails = (): boolean => {
    if (process.env.NODE_ENV !== 'production') return true;
    if (typeof window === 'undefined') return false;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('debugPreview') === '1') return true;
    } catch {
      // ignore
    }
    try {
      return localStorage.getItem('kloner.debug') === '1';
    } catch {
      return false;
    }
  };

  const buildUserFacingPreviewError = (args: {
    uiTitle?: string;
    uiMessage?: string;
    errorMessage?: string;
    reqId?: string;
    flyIsDischargeMissing?: boolean;
  }): string => {
    const showDetails = shouldShowInternalPreviewDetails();

    const uiTitle = String(args.uiTitle || '').trim();
    const uiMsg = String(args.uiMessage || '').trim();
    const errorMessage = String(args.errorMessage || '').trim();
    const reqId = String(args.reqId || '').trim();

    const genericFallback = "Something went wrong — We couldn’t get your preview ready. Please try again.";

    // Internal-only: very specific infra guidance should never be shown to end users.
    if (args.flyIsDischargeMissing) {
      if (!showDetails) return "Preview is temporarily unavailable. Please try again in a few minutes or contact support.";
      return (
        "Fly Machines API rejected the token used by the hub (tracksite-hub). The FlyV1 token is missing its third-party discharge token (likely split/truncated).\n\n" +
        "Fix: update the Fly app 'tracksite-hub' secret so FLY_API_TOKEN is a single full token: 'FlyV1 <macaroon>,<discharge>' (do not split on commas). Then restart/redeploy the hub and try again." +
        (reqId ? `\n\nFly requestId: ${reqId}` : '')
      );
    }

    // If backend text is generic (or empty), prefer our own stable message.
    const isGenericUi =
      uiTitle.toLowerCase() === 'something went wrong' ||
      uiMsg.toLowerCase().includes("couldn’t get your preview ready") ||
      uiMsg.toLowerCase().includes("couldn't get your preview ready") ||
      uiMsg.toLowerCase().includes('could not start the preview');

    // Map known sensitive/internal-ish error strings to user-safe messaging.
    const lower = `${uiTitle} ${uiMsg} ${errorMessage}`.toLowerCase();
    const looksLikeBilling =
      lower.includes('billing account') ||
      lower.includes('delinquent') ||
      lower.includes('past_due') ||
      lower.includes('payment') ||
      lower.includes('invoice') ||
      lower.includes('subscription');

    if (!showDetails) {
      if (looksLikeBilling) {
        return "Preview is unavailable for this project due to an account issue. Please check your billing or contact support.";
      }

      if (!uiTitle && !uiMsg) return genericFallback;
      if (isGenericUi) return genericFallback;
      return [uiTitle, uiMsg].filter(Boolean).join(' — ') || genericFallback;
    }

    // Debug mode: include the underlying error message when the UI text is generic.
    let userFacing = [uiTitle, uiMsg].filter(Boolean).join(' — ');
    if (!userFacing) userFacing = errorMessage || genericFallback;
    else if (isGenericUi && errorMessage && !userFacing.toLowerCase().includes(errorMessage.toLowerCase())) {
      userFacing = `${userFacing}\n\nDetails: ${errorMessage}`;
    }
    if (reqId) userFacing = `${userFacing}\n\nRequestId: ${reqId}`;
    return userFacing;
  };

  const buildHubStatusUrl = (code: string, deploymentUrl: string): string | null => {
    try {
      const normalized = normalizePreviewUrlHost(deploymentUrl);
      const u = new URL(normalized, typeof window !== 'undefined' ? window.location.origin : undefined);
      const token = u.searchParams.get('t');
      if (!token) return null;

      const statusPath = `/preview/${encodeURIComponent(code)}/status?t=${encodeURIComponent(token)}`;
      if (isHubHost(u.hostname.toLowerCase())) {
        return `${u.origin}${statusPath}`;
      }

      return `https://${CUSTOM_PREVIEW_HOST || DEFAULT_HUB_HOST}${statusPath}`;
    } catch {
      return null;
    }
  };

  const deriveCodeFromHubStatusUrl = (url: string): string | null => {
    try {
      const u = new URL(String(url || ''));
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 3 && parts[0] === 'preview' && parts[2] === 'status') {
        const code = String(parts[1] || '').trim();
        return code || null;
      }
      return null;
    } catch {
      return null;
    }
  };

  const looksLikeCookieIframeIssue = (message: string): boolean => {
    const m = String(message || '').toLowerCase();
    if (!m) return false;
    return (
      (m.includes('cookie') && m.includes('iframe')) ||
      m.includes('routing cookie') ||
      m.includes('third-party cookies') ||
      m.includes('third party cookies') ||
      m.includes('embedded iframe')
    );
  };

  const isSafariLikeBrowser = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '').toLowerCase();
    const isSafari = ua.includes('safari');
    const nonSafariMarkers = ['chrome', 'crios', 'chromium', 'edg/', 'edgios', 'opr/', 'firefox', 'fxios'];
    return isSafari && !nonSafariMarkers.some((marker) => ua.includes(marker));
  };

  const isEdgeLikeBrowser = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '').toLowerCase();
    return ua.includes('edg/') || ua.includes('edgios');
  };

  const shouldBypassIframeForBrowserCookiePolicy = (url: string): boolean => {
    if (!isTrustedBrowserPreviewUrl(url, typeof window !== 'undefined' ? window.location.origin : undefined)) return false;
    if (forceExternalPreviewRef.current && isHubPreviewUrl(url)) return true;
    if (!isSafariLikeBrowser()) return false;

    // Avoid Safari false-positives: do not bypass iframe on first load.
    // Only auto-bypass after we've observed an embed failure for this preview URL/code.
    const key = derivePreviewCodeFromUrl(url) || normalizePreviewUrlHost(url);
    return Boolean(key && safariEmbedFailureByCodeRef.current[key]);
  };

  const detectBrowserLabel = (): string => {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = String(navigator.userAgent || '');
    const lower = ua.toLowerCase();
    if (lower.includes('edg/')) return 'Edge';
    if (lower.includes('firefox') || lower.includes('fxios')) return 'Firefox';
    if (lower.includes('opr/') || lower.includes('opera')) return 'Opera';
    if (lower.includes('chrome') || lower.includes('crios')) return 'Chrome';
    if (lower.includes('safari')) return 'Safari';
    return 'unknown';
  };

  const stopAllTimers = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (automaticRetryTimeoutRef.current) {
      clearTimeout(automaticRetryTimeoutRef.current);
      automaticRetryTimeoutRef.current = null;
    }
    if (statusPollTimeoutRef.current) {
      clearTimeout(statusPollTimeoutRef.current);
      statusPollTimeoutRef.current = null;
    }
    if (iframeLoadTimeoutRef.current) {
      clearTimeout(iframeLoadTimeoutRef.current);
      iframeLoadTimeoutRef.current = null;
    }
    if (iframeCriticalTimeoutRef.current) {
      clearTimeout(iframeCriticalTimeoutRef.current);
      iframeCriticalTimeoutRef.current = null;
    }
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }
  };
  
  useEffect(() => {
    return () => {
      if (automaticRetryTimeoutRef.current) {
        clearTimeout(automaticRetryTimeoutRef.current);
        automaticRetryTimeoutRef.current = null;
      }
    };
  }, []);

  // Helper function to get CSRF token from cookies
  const ensureSessionAndCsrf = async (): Promise<string | null> => {
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
      return null;
    };
    return getCookie('csrf');
  };

  // Helper function to get authenticated headers for API calls
  const getAuthenticatedHeaders = async (): Promise<Record<string, string>> => {
    // Always fetch a fresh CSRF token to avoid stale token issues
    let csrf: string | null = null;
    try {
      const res = await fetch("/api/auth/csrf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        csrf = data?.csrf || null;
      }
    } catch (error: any) {
      console.warn("Failed to fetch CSRF token:", error);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (csrf) headers["x-csrf"] = String(csrf);
    return headers;
  };

  const extractTimeoutBackendContext = (rawStatusData: any) => {
    const backend: any = rawStatusData && typeof rawStatusData === 'object' ? rawStatusData : null;
    const backendDebug = (backend?.debug && typeof backend.debug === 'object' ? backend.debug : {}) as Record<string, any>;
    const machine = (backendDebug?.machine && typeof backendDebug.machine === 'object' ? backendDebug.machine : {}) as Record<string, any>;
    const machineId = String(
      backend?.machineId ||
      backend?.machine?.id ||
      machine?.id ||
      backendDebug?.machineId ||
      ''
    ).trim() || null;
    const machineState = String(
      machine?.state ||
      backend?.machineState ||
      backend?.machine?.state ||
      ''
    ).trim() || null;
    const restartCountRaw = machine?.restartCount;
    const restartCount = typeof restartCountRaw === 'number' && Number.isFinite(restartCountRaw)
      ? Math.floor(restartCountRaw)
      : null;

    return {
      backend: backend
        ? {
            status: String(backend?.status || '').trim() || null,
            uiStage: String(backend?.uiStage || '').trim() || null,
            debug: {
              timeoutReason: String(backendDebug?.timeoutReason || backend?.timeoutReason || '').trim() || null,
              machine: {
                id: machineId,
                state: machineState,
                restartCount,
              },
              compile: {
                summary: backendDebug?.compile?.summary ?? backend?.compileError?.summary ?? null,
              },
              storage: {
                rootfsIoCorruption: backendDebug?.storage?.rootfsIoCorruption ?? null,
              },
            },
          }
        : null,
      machineId,
      machineState,
      restartCount,
      requestId: String(
        backend?.requestId ||
        backend?.reqId ||
        backendDebug?.requestId ||
        backendDebug?.reqId ||
        ''
      ).trim() || null,
      jobId: String(backend?.jobId || backendDebug?.jobId || '').trim() || null,
    };
  };

  const reportPreviewTimeout = async (payload: {
    appId: string;
    code?: string;
    action?: string;
    severity?: 'critical' | 'error' | 'warning' | 'info';
    statusCode?: number;
    status?: string;
    message: string;
    ageMs?: number;
    elapsedMs?: number;
    previewUrl?: string | null;
    browser?: string;
    userAgent?: string;
    reason?: string;
    requestId?: string;
    jobId?: string;
    alertKey?: string;
    deduped?: boolean;
    backend?: any;
  }) => {
    try {
      const headers = await getAuthenticatedHeaders();
      await fetch('/api/internal/observability/frontend-timeout', {
        method: 'POST',
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn('[WebContainerRunner] failed to report preview timeout', error);
    }
  };

  const shouldEmitAlertForKey = (alertKey: string, ttlMs = PREVIEW_ALERT_DEDUPE_TTL_MS): { deduped: boolean } => {
    try {
      if (typeof window === 'undefined') return { deduped: false };
      const storageKey = 'kloner.preview.alert.dedupe.v1';
      const now = Date.now();
      const raw = window.sessionStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      const next: Record<string, number> = {};

      for (const [k, at] of Object.entries(parsed)) {
        if (typeof at === 'number' && now - at < ttlMs) {
          next[k] = at;
        }
      }

      const deduped = shouldDedupeAlert(next, alertKey, now, ttlMs);
      if (!deduped) next[alertKey] = now;
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      return { deduped };
    } catch {
      return { deduped: false };
    }
  };

  const reportPreviewAlert = async (payload: {
    appId: string;
    code?: string;
    action: string;
    alertKeyOverride?: string;
    dedupeTtlMs?: number;
    severity: 'critical' | 'error' | 'warning' | 'info';
    statusCode?: number;
    status?: string;
    reason?: string;
    message: string;
    elapsedMs?: number;
    previewUrl?: string | null;
    requestId?: string;
    jobId?: string;
    correlationIds?: Array<{ label: string; value: string }>;
    backendStatusData?: any;
    force?: boolean;
  }): Promise<{ sent: boolean; deduped: boolean; alertKey: string }> => {
    const code = payload.code || pollingCodeRef.current || undefined;
    const alertKey =
      (payload.alertKeyOverride && String(payload.alertKeyOverride).trim()) ||
      buildPreviewAlertKey({
        userId: user?.uid,
        appId: payload.appId,
        code,
        reason: payload.reason || payload.action,
      });

    // Product requirement: webhook errors should represent terminal failures,
    // not slow-start latency while the preview may still recover.
    if (payload.action === 'preview_slow_start_warn' || payload.action === 'preview_slow_start_critical') {
      return { sent: false, deduped: true, alertKey };
    }

    const dedupe = shouldEmitAlertForKey(alertKey, payload.dedupeTtlMs);
    if (dedupe.deduped && !payload.force) {
      return { sent: false, deduped: true, alertKey };
    }

    const backendContext = extractTimeoutBackendContext(payload.backendStatusData || lastBackendStatusRef.current || null);
    const backend: any = backendContext.backend;
    const backendDebug = (backend?.debug && typeof backend.debug === 'object' ? backend.debug : {}) as Record<string, any>;

    const debugPayload = {
      appId: payload.appId,
      code: code || null,
      userId: user?.uid || null,
      requestId: payload.requestId || backendContext.requestId || null,
      jobId: payload.jobId || backendContext.jobId || null,
      correlationIds: payload.correlationIds || null,
      elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : null,
      backend: {
        status: backend?.status || null,
        uiStage: backend?.uiStage || null,
        debug: {
          timeoutReason: backendDebug?.timeoutReason || null,
          machine: {
            id: backendContext.machineId,
            state: backendContext.machineState,
            restartCount: backendContext.restartCount,
          },
          compile: {
            summary: backendDebug?.compile?.summary ?? backend?.compileError?.summary ?? null,
          },
          storage: {
            rootfsIoCorruption: backendDebug?.storage?.rootfsIoCorruption ?? null,
          },
        },
      },
      alertKey,
      deduped: false,
    };

    await reportPreviewTimeout({
      appId: payload.appId,
      code,
      action: payload.action,
      severity: payload.severity,
      statusCode: payload.statusCode,
      status: payload.status,
      reason: payload.reason,
      message: payload.message,
      elapsedMs: payload.elapsedMs,
      ageMs: payload.elapsedMs,
      previewUrl: payload.previewUrl,
      browser: detectBrowserLabel(),
      userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : 'unknown',
      requestId: debugPayload.requestId || undefined,
      jobId: debugPayload.jobId || undefined,
      alertKey,
      deduped: false,
      backend: debugPayload.backend,
    });

    return { sent: true, deduped: false, alertKey };
  };

  const reportLoadingIssueOnce = (key: string, payload: {
    appId: string;
    code?: string;
    action?: string;
    severity?: 'critical' | 'error' | 'warning' | 'info';
    statusCode?: number;
    status?: string;
    message: string;
    ageMs?: number;
    elapsedMs?: number;
    previewUrl?: string | null;
    browser?: string;
    userAgent?: string;
    reason?: string;
    requestId?: string;
    jobId?: string;
    backendStatusData?: any;
  }) => {
    if (lastTimeoutReportKeyRef.current === key) return;
    lastTimeoutReportKeyRef.current = key;
    void reportPreviewAlert({
      appId: payload.appId,
      code: payload.code,
      action: payload.action || payload.status || 'preview_timeout_12min',
      severity: payload.severity || 'critical',
      statusCode: payload.statusCode,
      status: payload.status,
      reason: payload.reason,
      message: payload.message,
      elapsedMs: payload.elapsedMs ?? payload.ageMs,
      previewUrl: payload.previewUrl,
      requestId: payload.requestId,
      jobId: payload.jobId,
      backendStatusData: payload.backendStatusData,
    });
  };

  const reportPollIssueOnce = (key: string, payload: {
    appId: string;
    code?: string;
    action?: string;
    severity?: 'critical' | 'error' | 'warning' | 'info';
    statusCode?: number;
    status?: string;
    message: string;
    ageMs?: number;
    elapsedMs?: number;
    previewUrl?: string | null;
    browser?: string;
    userAgent?: string;
    reason?: string;
    requestId?: string;
    jobId?: string;
    correlationIds?: Array<{ label: string; value: string }>;
    backendStatusData?: any;
    alertKeyOverride?: string;
    dedupeTtlMs?: number;
  }) => {
    if (lastPollIssueReportKeyRef.current === key) return;
    lastPollIssueReportKeyRef.current = key;
    void reportPreviewAlert({
      appId: payload.appId,
      code: payload.code,
      action: payload.action || payload.status || 'preview_timeout_12min',
      severity: payload.severity || 'critical',
      statusCode: payload.statusCode,
      status: payload.status,
      reason: payload.reason,
      message: payload.message,
      elapsedMs: payload.elapsedMs ?? payload.ageMs,
      previewUrl: payload.previewUrl,
      requestId: payload.requestId,
      jobId: payload.jobId,
      correlationIds: payload.correlationIds,
      backendStatusData: payload.backendStatusData,
      alertKeyOverride: payload.alertKeyOverride,
      dedupeTtlMs: payload.dedupeTtlMs,
    });
  };

  const emitCompileErrorTelemetry = useCallback((kind: 'compile_error_seen' | 'compile_error_fix_clicked' | 'compile_error_fix_sent' | 'compile_error_recovered', detail: Record<string, any>) => {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(
        new CustomEvent('kloner:ai-agent-event', {
          detail: {
            kind,
            ts: Date.now(),
            appId,
            ...detail,
          },
        })
      );
    } catch {
      // ignore
    }
  }, [appId]);

  const getCompileErrorStateFromStatus = useCallback((code: string, statusData: any) => {
    const failure = normalizePreviewFailureContract(statusData);
    if (!failure) return null;
    if (!canShowPreviewFixWithAi(failure)) return null;

    const compileErrorFromFailure = failure.compileError || null;
    const compileError = statusData?.compileError && typeof statusData.compileError === 'object' ? statusData.compileError : {};
    const summary = String(compileErrorFromFailure?.summary || compileError?.summary || '').trim();
    const detail = String(compileErrorFromFailure?.detail || compileError?.detail || statusData?.error || statusData?.uiMessage || '').trim();
    const fingerprint = String(compileErrorFromFailure?.fingerprint || compileError?.fingerprint || `${code}:${summary || 'compile_error'}`).trim();
    const quickFixEligible = compileErrorFromFailure?.quickFixEligible === true || compileError?.quickFixEligible === true;

    const quickActions = Array.isArray(statusData?.quickActions) ? statusData.quickActions : [];
    const quickFixAction = quickActions.find((action: any) => String(action?.type || '').toLowerCase() === 'quick_fix_compile');
    const fixActionId = String(compileError?.fixAction || quickFixAction?.id || quickFixAction?.actionId || '').trim();

    const canShowFixWithAiCta = canShowPreviewFixWithAi(failure);

    const normalizedSummary = summary || 'Compilation failed while preparing your preview.';
    return {
      code,
      summary: normalizedSummary,
      detail,
      fingerprint,
      quickFixEligible,
      actionType: 'quick_fix_compile' as const,
      fixAction: fixActionId || undefined,
      userAction: failure.userAction,
      canShowFixWithAiCta,
    };
  }, []);

  type ProbeResult = {
    ok: boolean;
    reachable: boolean;
    status?: number;
    finalUrl?: string | null;
    redirected?: boolean;
    crossOriginRedirect?: boolean;
    error?: string;
  };

  const probePreviewUrl = async (appId: string, url: string): Promise<ProbeResult> => {
    const attempts = 2;
    for (let i = 0; i < attempts; i++) {
      try {
        const headers = await getAuthenticatedHeaders();
        const res = await fetch(
          `/api/webcontainer-probe?appId=${encodeURIComponent(appId)}&url=${encodeURIComponent(url)}`,
          { method: 'GET', headers, credentials: 'include', cache: 'no-store' }
        );
        const data = await res.json().catch(() => null);
        if (res.ok && (data as any)?.ok) {
          return {
            ok: true,
            reachable: Boolean((data as any)?.reachable),
            status: typeof (data as any)?.status === 'number' ? (data as any).status : undefined,
            finalUrl: (data as any)?.finalUrl ?? null,
            redirected: Boolean((data as any)?.redirected),
            crossOriginRedirect: Boolean((data as any)?.crossOriginRedirect),
          };
        }
        return {
          ok: false,
          reachable: false,
          status: res.status,
          error: typeof (data as any)?.error === 'string' ? (data as any).error : 'probe_failed',
        };
      } catch {
        // ignore; retry
      }

      // small backoff before retry
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    return { ok: false, reachable: false, error: 'probe_failed' };
  };

  const getFlyAppFromUrl = (maybeUrl: string): string | null => {
    try {
      const u = new URL(maybeUrl);
      const host = u.hostname;
      if (!host.endsWith(".fly.dev")) return null;
      const app = host.replace(/\.fly\.dev$/i, "");
      return app || null;
    } catch {
      return null;
    }
  };

  const getFlyMachineState = async (
    previewUrl: string,
    machineId: string
  ): Promise<{ ok: true; state?: string } | { ok: false; reason: string }> => {
    const app = getFlyAppFromUrl(previewUrl);
    if (!app) return { ok: false, reason: "no_fly_app" };

    try {
      const headers = await getAuthenticatedHeaders();
      const res = await fetch(
        `/api/fly-machine-status?app=${encodeURIComponent(app)}&machineId=${encodeURIComponent(machineId)}&appId=${encodeURIComponent(appId)}`,
        { method: "GET", headers, credentials: "include", cache: "no-store" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 404) return { ok: false, reason: "not_found" };
        const reason = typeof (data as any)?.reason === 'string' ? String((data as any).reason) : 'http_error';
        return { ok: false, reason };
      }
      if (!data?.ok) return { ok: false, reason: String(data?.reason || "not_ok") };
      return { ok: true, state: data?.state };
    } catch {
      return { ok: false, reason: "fetch_failed" };
    }
  };

  const isFlyMachineRunning = async (
    previewUrl: string,
    machineId: string
  ): Promise<{ ok: true; running: boolean; state?: string } | { ok: false; reason: string }> => {
    const flyState = await getFlyMachineState(previewUrl, machineId);
    if (!flyState.ok) return flyState;

    const normalized = String(flyState.state || "").toLowerCase();
    // Fly can report transient states during deploy/replace even while the app is
    // actually reachable. Be conservative about clearing stored machine references:
    // only treat explicitly terminal/off states as not running.
    const explicitlyNotRunning = new Set([
      "stopped",
      "stopping",
      "destroyed",
      "destroying",
      "dead",
      "failed",
    ]);
    const running = normalized ? !explicitlyNotRunning.has(normalized) : true;
    return { ok: true, running, state: flyState.state };
  };

  const handleAssetFailure = () => {
    // Don't count failures if iframe already loaded successfully
    if (iframeLoadedSuccessfullyRef.current) return;

    assetFailureCountRef.current += 1;
    console.log(`Asset failure detected (${assetFailureCountRef.current}/${maxAssetFailures})`);

    // Do not trigger restarts automatically. If the preview is failing to serve assets,
    // surface the issue and let the user retry/reconnect/start fresh.
    if (assetFailureCountRef.current >= maxAssetFailures) {
      setCanRetry(true);
    }
  };
  const retryApp = () => {
    const now = Date.now();
    if (now - previewActionThrottleRef.current.refreshAt < 1500) return;
    previewActionThrottleRef.current.refreshAt = now;

    console.log('[WebContainerRunner] Manual refresh requested', {
      appId,
      startAttempt,
      reconnectOnly: reconnectOnlyRef.current,
    });
    recordDebugEvent('manual_refresh_requested', {
      appId,
      startAttempt,
      reconnectOnly: reconnectOnlyRef.current,
    });

    stopAllTimers();

    setStartAttempt(0);
    setError(null);
    setCompileErrorState(null);
    setCookieRecoveryPromptVisible(false);
    setIsPolling(false); // Reset polling state
    setPreviewUrl(null);
    previewUrlFirstSeenAtRef.current = 0;
    setCanRetry(false);
    setLoadingStatus(''); // Clear loading status on retry
    setCurrentStatusData(null); // Clear status data on retry
    setPollNetworkWarning(null);
    setConnectingToExisting(false); // Reset connection state
    lastStartKeyRef.current = null;
    retryScheduledRef.current = false;
    totalAttemptsRef.current = 0; // Reset circuit breaker on manual retry
    assetFailureCountRef.current = 0; // Reset asset failure count
    appLoadedSuccessfullyRef.current = false; // Reset server success flag
    iframeLoadedSuccessfullyRef.current = false; // Reset iframe success flag
    pollingCodeRef.current = null; // Reset polling code
    activePollCodeRef.current = null;
    previewRegistrationGraceUntilRef.current = 0;
    compileErrorActiveFingerprintRef.current = null;
    iframePostLoadRecoveryCountRef.current = 0;
    pollFetchFailureCountRef.current = 0;
    lastPollFailureSignatureRef.current = '';
    repeatedPollFailureCountRef.current = 0;
    lastPreviewGenerationKeyRef.current = '';
    lastPollIssueReportKeyRef.current = '';
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }

    // Ensure manual refresh always retriggers the startup effect,
    // even when other dependency values remain unchanged.
    setManualStartNonce((prev) => prev + 1);

    // Do not clear stored container code on retry.
    // Retry should attempt to reconnect to the saved machine first.
  };

  const rebuildPreview = async () => {
    const now = Date.now();
    if (now - previewActionThrottleRef.current.rebuildAt < 5000) return;
    previewActionThrottleRef.current.rebuildAt = now;

    console.log('[WebContainerRunner] Manual rebuild requested', {
      appId,
      startAttempt,
      reconnectOnly: reconnectOnlyRef.current,
    });
    recordDebugEvent('manual_rebuild_requested', {
      appId,
      startAttempt,
      reconnectOnly: reconnectOnlyRef.current,
      previewUrl: previewUrlRef.current,
      backendStatus: lastBackendStatusRef.current,
    });

    try {
      await onRequestRebuild?.();
      return;
    } catch (err) {
      console.warn('[WebContainerRunner] rebuild callback failed; falling back to refresh', err);
    }

    stopAllTimers();

    setStartAttempt(0);
    setError(null);
    setCompileErrorState(null);
    setCookieRecoveryPromptVisible(false);
    setIsPolling(false);
    setIsLoading(true);
    setPreviewUrl(null);
    previewUrlFirstSeenAtRef.current = 0;
    setCanRetry(false);
    setLoadingStatus('Rebuilding preview…');
    setCurrentStatusData(null);
    setPollNetworkWarning(null);
    setConnectingToExisting(false);
    lastStartKeyRef.current = null;
    retryScheduledRef.current = false;
    totalAttemptsRef.current = 0;
    assetFailureCountRef.current = 0;
    appLoadedSuccessfullyRef.current = false;
    iframeLoadedSuccessfullyRef.current = false;
    pollingCodeRef.current = null;
    activePollCodeRef.current = null;
    previewRegistrationGraceUntilRef.current = 0;
    compileErrorActiveFingerprintRef.current = null;
    iframePostLoadRecoveryCountRef.current = 0;
    pollFetchFailureCountRef.current = 0;
    lastPollFailureSignatureRef.current = '';
    repeatedPollFailureCountRef.current = 0;
    lastPollIssueReportKeyRef.current = '';
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }

    retryApp();
  };

  const scheduleAutomaticPreviewRestart = (reason: string, delayMs: number = 6000) => {
    if (retryScheduledRef.current) return;
    if (totalAttemptsRef.current >= maxTotalAttempts) return;

    retryScheduledRef.current = true;
    if (automaticRetryTimeoutRef.current) {
      clearTimeout(automaticRetryTimeoutRef.current);
    }

    automaticRetryTimeoutRef.current = setTimeout(() => {
      console.log(`[WebContainerRunner] Automatic preview restart (${reason})`);
      retryScheduledRef.current = false;
      retryApp();
    }, delayMs);
  };
  const proxyBaseRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewUrlFirstSeenAtRef = useRef<number>(0);
  const hmrWsRef = useRef<WebSocket | null>(null);
  const hmrWsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastHmrWsCheckKeyRef = useRef<string>('');
  const autoReloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFilesSignatureRef = useRef<string>('');
  const lastReloadIssuedAtRef = useRef<number>(0);
  const lastReloadTokenRef = useRef<number | null>(null);
  const lastApplyTokenRef = useRef<number | null>(null);
  const applyReloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRestartTokenRef = useRef<number | null>(null);
  const lastReconnectTokenRef = useRef<number | null>(null);
  const lastNavigatePathTokenRef = useRef<number | null>(null);
  const lastPreviewUrlForLoadRef = useRef<string | null>(null);
  const lastExternalPreviewOpenedUrlRef = useRef<string | null>(null);
  const lastCookieBlockReportKeyRef = useRef<string>('');
  const embedPolicySignalTimesRef = useRef<number[]>([]);
  const embedPolicySpamMutedUntilRef = useRef<number>(0);
  const embedPolicyLastEscalationKeyRef = useRef<string>('');
  const forceExternalPreviewRef = useRef(false);
  const safariEmbedFailureByCodeRef = useRef<Record<string, number>>({});
  const reconnectOnlyRef = useRef(false);
  const filesRef = useRef(files);
  const startRunIdRef = useRef(0);
  const effectStartedAtRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ensuredConfigRef = useRef(false);

  const EMBED_POLICY_SPAM_WINDOW_MS = 12_000;
  const EMBED_POLICY_SPAM_THRESHOLD = 4;
  const EMBED_POLICY_SPAM_MUTED_MS = 2 * 60 * 1000;

  const registerEmbedPolicySignal = (): { triggered: boolean; count: number } => {
    const now = Date.now();
    const recent = embedPolicySignalTimesRef.current.filter((ts) => now - ts <= EMBED_POLICY_SPAM_WINDOW_MS);
    recent.push(now);
    embedPolicySignalTimesRef.current = recent;

    if (now < embedPolicySpamMutedUntilRef.current) {
      return { triggered: false, count: recent.length };
    }

    if (recent.length < EMBED_POLICY_SPAM_THRESHOLD) {
      return { triggered: false, count: recent.length };
    }

    embedPolicySpamMutedUntilRef.current = now + EMBED_POLICY_SPAM_MUTED_MS;
    embedPolicySignalTimesRef.current = [];
    return { triggered: true, count: recent.length };
  };

  const switchToExternalPreviewMode = (url: string, reason: string, opts?: { suppressEmbedBlockedReport?: boolean }) => {
    const normalizedUrl = normalizePreviewUrlHost(url);
    if (!normalizedUrl) return;
    const browserUrl = buildBrowserPreviewUrl(normalizedUrl);

    markSafariEmbedFailure(normalizedUrl);

    forceExternalPreviewRef.current = true;
    setExternalPreviewMode(true);
    setError(null);
    setCanRetry(false);
    setCookieRecoveryPromptVisible(false);
    setIsLoading(false);
    setIsPolling(false);
    setConnectingToExisting(false);

    if (!opts?.suppressEmbedBlockedReport) {
      reportCookieIframeBlocked({
        previewUrl: normalizedUrl,
        reason,
        message: 'Embedded preview failed repeatedly; switching to external preview fallback.',
      });
    }

    let opened: Window | null = null;
    try {
      opened = window.open(browserUrl, '_blank', 'noopener,noreferrer');
    } catch {
      opened = null;
    }
    setExternalPreviewAutoOpenFailed(!opened);
    try { onPreviewReadyChange?.(true); } catch { }
  };

  const handleEmbedPolicySignal = (args: { source: 'csp' | 'embed'; reason: string; detail?: string }) => {
    const signal = registerEmbedPolicySignal();
    if (!signal.triggered) return;

    const activeUrl = normalizePreviewUrlHost(String(previewUrlRef.current || ''));
    const activeCode = derivePreviewCodeFromUrl(activeUrl) || pollingCodeRef.current || 'unknown';
    const escalationKey = `${appId}:${activeCode}`;
    if (embedPolicyLastEscalationKeyRef.current === escalationKey) return;
    embedPolicyLastEscalationKeyRef.current = escalationKey;

    void reportPreviewAlert({
      appId,
      code: pollingCodeRef.current || undefined,
      action: 'preview_embed_policy_spam_detected',
      severity: 'critical',
      statusCode: 429,
      status: 'embed_policy_spam',
      reason: `embed_policy_spam_${args.source}`,
      message: `Detected ${signal.count} embed-policy/CSP blocks within ${Math.round(EMBED_POLICY_SPAM_WINDOW_MS / 1000)}s; auto-switching to external preview to stop repeated failures.`,
      previewUrl: activeUrl || undefined,
      alertKeyOverride: `preview_embed_policy_spam_detected:${user?.uid || 'anonymous'}:${appId}:${activeCode}`,
      dedupeTtlMs: 30 * 60 * 1000,
      backendStatusData: {
        status: 'embed_policy_spam',
        uiStage: 'embedded_iframe',
        debug: {
          timeoutReason: `embed_policy_spam_${args.source}`,
          source: args.source,
          reason: args.reason,
          detail: args.detail || null,
          countWithinWindow: signal.count,
          windowMs: EMBED_POLICY_SPAM_WINDOW_MS,
        },
      },
    });

    if (activeUrl && isValidPreviewUrlCandidate(activeUrl)) {
      switchToExternalPreviewMode(activeUrl, 'embed_policy_spam_detected_auto_external', {
        suppressEmbedBlockedReport: true,
      });
    }
  };

  const reportCookieIframeBlocked = (args: { previewUrl?: string | null; reason: string; message: string }) => {
    if (typeof window === 'undefined') return;
    const ua = String(window.navigator?.userAgent || 'unknown');
    const browser = detectBrowserLabel();
    const key = `${appId}:${args.reason}:${String(args.previewUrl || '')}:${browser}`;
    if (lastCookieBlockReportKeyRef.current === key) return;
    lastCookieBlockReportKeyRef.current = key;

    void reportPreviewAlert({
      appId,
      code: pollingCodeRef.current || undefined,
      action: 'preview_embed_policy_blocked',
      severity: 'error',
      statusCode: 403,
      status: 'iframe_cookie_blocked',
      reason: args.reason,
      message: args.message,
      previewUrl: args.previewUrl || previewUrlRef.current,
      alertKeyOverride: `preview_embed_policy_blocked:${user?.uid || 'anonymous'}:${appId}:${String(args.reason || 'unknown').toLowerCase()}`,
      backendStatusData: {
        status: 'iframe_cookie_blocked',
        uiStage: 'embedded_iframe',
        debug: {
          timeoutReason: String(args.reason || '').toLowerCase() || null,
          browser,
          userAgent: ua,
        },
      },
    });

    if (!String(args.reason || '').includes('spam_detected')) {
      handleEmbedPolicySignal({ source: 'embed', reason: args.reason, detail: args.message });
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onCspViolation = (event: SecurityPolicyViolationEvent) => {
      try {
        const directive = String(event.effectiveDirective || event.violatedDirective || 'unknown').toLowerCase();
        const blockedUri = String(event.blockedURI || '').trim();
        const documentUri = String(event.documentURI || '').trim();
        const sourceFile = String(event.sourceFile || '').trim();
        const reason = `csp_${directive || 'unknown'}`;

        void reportPreviewAlert({
          appId,
          code: pollingCodeRef.current || undefined,
          action: 'preview_csp_violation',
          severity: 'error',
          statusCode: 403,
          status: 'csp_violation',
          reason,
          message: `CSP blocked '${directive || 'unknown'}' in the preview/editor context.`,
          previewUrl: previewUrlRef.current,
          alertKeyOverride: `preview_csp_violation:${user?.uid || 'anonymous'}:${appId}:${directive}`,
          dedupeTtlMs: 15 * 60 * 1000,
          backendStatusData: {
            status: 'csp_violation',
            uiStage: 'embedded_iframe',
            debug: {
              timeoutReason: reason,
              csp: {
                effectiveDirective: directive,
                blockedURI: blockedUri || null,
                documentURI: documentUri || null,
                sourceFile: sourceFile || null,
                lineNumber: Number.isFinite(event.lineNumber) ? event.lineNumber : null,
                columnNumber: Number.isFinite(event.columnNumber) ? event.columnNumber : null,
                disposition: String(event.disposition || '').trim() || null,
                sample: String(event.sample || '').trim() || null,
              },
            },
          },
        });

        handleEmbedPolicySignal({ source: 'csp', reason, detail: blockedUri || sourceFile || directive || 'unknown' });
      } catch {
        // ignore
      }
    };

    window.addEventListener('securitypolicyviolation', onCspViolation as EventListener);
    return () => {
      window.removeEventListener('securitypolicyviolation', onCspViolation as EventListener);
    };
  }, [appId, user?.uid]);

  const markSafariEmbedFailure = (url: string) => {
    if (!isSafariLikeBrowser()) return;
    const key = derivePreviewCodeFromUrl(url) || normalizePreviewUrlHost(url);
    if (!key) return;
    safariEmbedFailureByCodeRef.current[key] = (safariEmbedFailureByCodeRef.current[key] || 0) + 1;
  };

  const clearSafariEmbedFailure = (url: string) => {
    const key = derivePreviewCodeFromUrl(url) || normalizePreviewUrlHost(url);
    if (!key) return;
    delete safariEmbedFailureByCodeRef.current[key];
  };

  const normalizeConfigJson = (raw: string): string => {
    try {
      const parsed: any = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }, null, 2) + '\n';
      }
      if (!parsed.compilerOptions || typeof parsed.compilerOptions !== 'object' || Array.isArray(parsed.compilerOptions)) {
        parsed.compilerOptions = {};
      }

      // Ensure the common @/* alias works in user apps.
      if (!parsed.compilerOptions.baseUrl || typeof parsed.compilerOptions.baseUrl !== 'string') {
        parsed.compilerOptions.baseUrl = ".";
      }
      if (!parsed.compilerOptions.paths || typeof parsed.compilerOptions.paths !== 'object' || Array.isArray(parsed.compilerOptions.paths)) {
        parsed.compilerOptions.paths = {};
      }
      if (!Array.isArray(parsed.compilerOptions.paths["@/*"])) {
        parsed.compilerOptions.paths["@/*"] = ["./*"];
      }

      return JSON.stringify(parsed, null, 2) + '\n';
    } catch {
      return JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }, null, 2) + '\n';
    }
  };

  const ensureNextConfigFiles = (inputFiles: any): { nextFiles: any; fixes: Array<{ path: string; content: string }> } => {
    const nextFiles: any = { ...(inputFiles || {}) };
    const fixes: Array<{ path: string; content: string }> = [];

    const tsRaw = typeof nextFiles['tsconfig.json']?.content === 'string' ? String(nextFiles['tsconfig.json'].content) : null;
    const jsRaw = typeof nextFiles['jsconfig.json']?.content === 'string' ? String(nextFiles['jsconfig.json'].content) : null;

    if (tsRaw != null) {
      const normalized = normalizeConfigJson(tsRaw);
      if (normalized !== tsRaw) {
        nextFiles['tsconfig.json'] = { ...(nextFiles['tsconfig.json'] || {}), content: normalized };
        fixes.push({ path: 'tsconfig.json', content: normalized });
      }
    }

    if (jsRaw != null) {
      const normalized = normalizeConfigJson(jsRaw);
      if (normalized !== jsRaw) {
        nextFiles['jsconfig.json'] = { ...(nextFiles['jsconfig.json'] || {}), content: normalized };
        fixes.push({ path: 'jsconfig.json', content: normalized });
      }
    }

    if (tsRaw == null && jsRaw == null) {
      const normalized = normalizeConfigJson('{"compilerOptions":{}}');
      nextFiles['jsconfig.json'] = { content: normalized };
      fixes.push({ path: 'jsconfig.json', content: normalized });
    }

    // Auto-heal common AI edits that assume @ alias + AuthProvider/NavBar exist.
    try {
      const layoutPath =
        typeof nextFiles['app/layout.js']?.content === 'string'
          ? 'app/layout.js'
          : typeof nextFiles['app/layout.jsx']?.content === 'string'
            ? 'app/layout.jsx'
            : typeof nextFiles['app/layout.tsx']?.content === 'string'
              ? 'app/layout.tsx'
              : typeof nextFiles['app/layout.ts']?.content === 'string'
                ? 'app/layout.ts'
                : null;

      const layoutContent = layoutPath ? String(nextFiles[layoutPath]?.content || '') : '';
      const usesAuthProvider = layoutContent.includes("@/components/AuthProvider");
      const usesNavBar = layoutContent.includes("@/components/NavBar");

      const hasAuthProvider =
        typeof nextFiles['components/AuthProvider.js']?.content === 'string' ||
        typeof nextFiles['components/AuthProvider.jsx']?.content === 'string' ||
        typeof nextFiles['components/AuthProvider.tsx']?.content === 'string' ||
        typeof nextFiles['components/AuthProvider.ts']?.content === 'string';

      const hasNavBar =
        typeof nextFiles['components/NavBar.js']?.content === 'string' ||
        typeof nextFiles['components/NavBar.jsx']?.content === 'string' ||
        typeof nextFiles['components/NavBar.tsx']?.content === 'string' ||
        typeof nextFiles['components/NavBar.ts']?.content === 'string';

      if (usesAuthProvider && !hasAuthProvider) {
        const content = `"use client";

export default function AuthProvider({ children }) {
  return children;
}
`;
        nextFiles['components/AuthProvider.js'] = { content };
        fixes.push({ path: 'components/AuthProvider.js', content });
      }

      if (usesNavBar && !hasNavBar) {
        const content = `"use client";

import Link from "next/link";

export default function NavBar() {
  return (
    <nav style={{ padding: 12, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
      <Link href="/">Home</Link>
    </nav>
  );
}
`;
        nextFiles['components/NavBar.js'] = { content };
        fixes.push({ path: 'components/NavBar.js', content });
      }
    } catch {
      // ignore
    }

    return { nextFiles, fixes };
  };

  const getUpdatedAtMs = (updatedAt: any): number | null => {
    try {
      if (!updatedAt) return null;
      if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) return updatedAt;
      if (updatedAt instanceof Date) return updatedAt.getTime();
      if (typeof updatedAt === 'string') {
        const parsed = Date.parse(updatedAt);
        return Number.isFinite(parsed) ? parsed : null;
      }
      const seconds = Number(updatedAt?._seconds);
      const nanos = Number(updatedAt?._nanoseconds ?? updatedAt?._nanos);
      if (!Number.isFinite(seconds)) return null;
      const ms = seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1_000_000 : 0);
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  };

  // Frontend grace window: if the preview flips to `status=error` very early,
  // keep polling because the backend/VM may still recover (restarts during boot).
  const PREVIEW_ERROR_GRACE_MS = 3 * 60 * 1000;

  const formatStatusTime = (ms: number) => {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  };

  const renderLiveStatusLine = (statusData: any) => {
    if (!statusData) return null;
    const detail = String(statusData?.uiMessage || '').trim();
    // UX requirement: show only subheader/body status text, never backend header/title.
    const message = detail;
    if (!message) return null;

    return (
      <div className="mt-6 w-full max-w-2xl px-6 py-2 text-left">
        <div className="text-sm text-black/60">
          <span>{message}</span>
        </div>
      </div>
    );
  };

  const normalizeStatusDataForUi = (code: string, raw: any): any => {
    try {
      const normalizedFailure = normalizePreviewFailureDetails(raw);
      const status = String((raw as any)?.status || normalizedFailure.backendStatus || '').toLowerCase();
      const uiStage = String((raw as any)?.uiStage || normalizedFailure.uiStage || '').toLowerCase();
      const transitioning = status === 'transitioning' || uiStage === 'transitioning' || uiStage.includes('transition');

      const uiProgressRaw = (raw as any)?.uiProgress;
      const explicitProgress =
        typeof uiProgressRaw === 'number' && Number.isFinite(uiProgressRaw)
          ? Math.max(0, Math.min(100, uiProgressRaw))
          : null;

      // If backend doesn't send uiProgress, infer a coarse progress from stage.
      const inferredProgress = (() => {
        if (status === 'ready') return 100;
        if (status === 'building' || status === 'compiling') return 60;
        if (status === 'booting' || status === 'starting' || status === 'creating_machine' || status === 'creating_server') return 20;
        if (transitioning) return 90;
        return 0;
      })();

      const nextProgress = explicitProgress == null ? inferredProgress : explicitProgress;
      const prev = typeof stickyProgressByCodeRef.current[code] === 'number' ? stickyProgressByCodeRef.current[code]! : 0;
      const sticky = Math.max(prev, nextProgress);
      stickyProgressByCodeRef.current[code] = sticky;

      return {
        ...raw,
        ...normalizedFailure,
        backendStatus: normalizedFailure.backendStatus || String((raw as any)?.backendStatus || '').trim() || null,
        uiStage: normalizedFailure.uiStage || String((raw as any)?.uiStage || '').trim() || null,
        timeoutReason: normalizedFailure.timeoutReason || String((raw as any)?.timeoutReason || '').trim() || null,
        machineState: normalizedFailure.machineState || String((raw as any)?.machineState || '').trim() || null,
        restartCount: normalizedFailure.restartCount,
        rootfsIoCorruption: normalizedFailure.rootfsIoCorruption,
        suggestedFix: normalizedFailure.suggestedFix,
        uiTitle: normalizedFailure.uiTitle || String((raw as any)?.uiTitle || '').trim() || null,
        uiMessage: normalizedFailure.uiMessage || String((raw as any)?.uiMessage || '').trim() || null,
        uiProgress: sticky,
        __transitioning: transitioning,
      };
    } catch {
      return raw;
    }
  };

  const getFlyMachineCreateFailure = (statusData: any): {
    status: number;
    requestId?: string;
    url?: string;
  } | null => {
    try {
      const events = Array.isArray(statusData?.events) ? statusData.events : [];
      for (const ev of events) {
        const flyApi = ev?.extra?.flyApi;
        if (!flyApi || typeof flyApi !== 'object') continue;

        const status = Number(flyApi?.status);
        const method = String(flyApi?.method || '').trim().toLowerCase();
        const url = String(flyApi?.url || '').trim();

        if (!Number.isFinite(status) || status < 400) continue;
        if (method !== 'post') continue;
        if (!/\/machines(\/|$|\?)/i.test(url)) continue;

        const requestId = String(flyApi?.requestId || '').trim() || undefined;
        return { status, requestId, url: url || undefined };
      }
      return null;
    } catch {
      return null;
    }
  };

  const renderBuildChecklist = (statusData: any) => {
    return null;
  };

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
    if (previewUrl) {
      if (!previewUrlFirstSeenAtRef.current) previewUrlFirstSeenAtRef.current = Date.now();
    } else {
      previewUrlFirstSeenAtRef.current = 0;
    }
  }, [previewUrl]);

  useEffect(() => {
    if (!previewUrl) return;
    const normalized = normalizePreviewUrlHost(previewUrl);
    const safeBrowserUrl = buildBrowserPreviewUrl(normalized);
    if (safeBrowserUrl !== previewUrl) {
      setPreviewUrl(safeBrowserUrl);
      return;
    }
    if (normalized !== previewUrl) {
      setPreviewUrl(normalized);
    }
  }, [previewUrl]);

  useEffect(() => {
    const statusData = currentStatusData || lastBackendStatusRef.current || null;
    if (!statusData) return;

    const machineId = String((statusData as any)?.machineId || (statusData as any)?.machine?.id || '').trim();
    const restartCount = Number(
      (statusData as any)?.restartCount ??
      (statusData as any)?.backend?.restartCount ??
      (statusData as any)?.debug?.restartCount ??
      0,
    );
    const bootstrapVersion = String(
      (statusData as any)?.previewBootstrapVersion ||
      (statusData as any)?.bootstrapVersion ||
      (statusData as any)?.previewVersion ||
      '',
    ).trim();
    const appServerKind = String((statusData as any)?.appServerKind || '').trim().toLowerCase();
    const code = pollingCodeRef.current || derivePreviewCodeFromUrl(String(previewUrlRef.current || '')) || 'unknown';
    const generationKey = [code, machineId || 'no-machine', Number.isFinite(restartCount) ? String(restartCount) : '0', bootstrapVersion || 'no-bootstrap', appServerKind || ''].join('|');

    if (generationKey === lastPreviewGenerationKeyRef.current) return;
    lastPreviewGenerationKeyRef.current = generationKey;

    if (!previewUrlRef.current) return;
    const safePreviewUrl = buildBrowserPreviewUrl(previewUrlRef.current);
    if (!safePreviewUrl) return;

    setIframeKey((k) => k + 1);
    setPreviewUrl(withCacheBust(safePreviewUrl));
  }, [currentStatusData, previewUrl]);

  useEffect(() => {
    if (!previewUrl) {
      setExternalPreviewMode(false);
      setExternalPreviewAutoOpenFailed(false);
      lastExternalPreviewOpenedUrlRef.current = null;
      forceExternalPreviewRef.current = false;
      return;
    }

    if (!shouldBypassIframeForBrowserCookiePolicy(previewUrl)) {
      setExternalPreviewMode(false);
      setExternalPreviewAutoOpenFailed(false);
      return;
    }

    setExternalPreviewMode(true);
    setError(null);
    setCanRetry(false);
    setCookieRecoveryPromptVisible(false);

    if (lastExternalPreviewOpenedUrlRef.current === previewUrl) {
      try { onPreviewReadyChange?.(true); } catch { }
      return;
    }

    reportCookieIframeBlocked({
      previewUrl,
      reason: 'safari_iframe_embed_policy',
      message: 'Safari blocked or white-screened embedded preview iframe; switched to external preview tab fallback.',
    });

    lastExternalPreviewOpenedUrlRef.current = previewUrl;
    let opened: Window | null = null;
    try {
      opened = window.open(previewUrl, '_blank', 'noopener,noreferrer');
    } catch {
      opened = null;
    }

    setExternalPreviewAutoOpenFailed(!opened);
    try { onPreviewReadyChange?.(true); } catch { }
  }, [previewUrl, onPreviewReadyChange]);

  // When the preview URL changes (new machine / new viewer token), re-show the overlay.
  useEffect(() => {
    iframeWarnContextRef.current = null;
    setShowPreviewUrlOverlay(true);
    setPreviewUrlDetailsOpen(false);
    setShowHmrWarning(true);
    setHmrWsStatus('unknown');
    lastHmrWsCheckKeyRef.current = '';

    if (hmrWsTimeoutRef.current) {
      clearTimeout(hmrWsTimeoutRef.current);
      hmrWsTimeoutRef.current = null;
    }
    if (hmrWsRef.current) {
      try { hmrWsRef.current.close(); } catch { }
      hmrWsRef.current = null;
    }
  }, [previewUrl]);

  // HMR relies on a websocket to `/_next/webpack-hmr` at the preview origin.
  // Some VPNs / proxies / adblockers block websockets, causing the iframe to stop live-updating.
  // We can't reliably detect "VPN enabled", but we can detect that the websocket can't connect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!previewUrl) return;
    if (externalPreviewMode) return;
    // Safari frequently reports noisy websocket handshake failures here even when the
    // preview is otherwise usable; skip proactive probing to avoid false negatives.
    if (isSafariLikeBrowser()) return;

    // Only relevant for hub + next-dev.
    const kind = String((currentStatusData as any)?.appServerKind || '').toLowerCase();
    if (kind !== 'next-dev') return;

    let u: URL;
    try {
      u = new URL(previewUrl, window.location.origin);
    } catch {
      return;
    }

    if (!isHubHost(u.hostname.toLowerCase())) return;
    const wsUrl = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/_next/webpack-hmr?page=/`;
    if (lastHmrWsCheckKeyRef.current === wsUrl) return;
    lastHmrWsCheckKeyRef.current = wsUrl;

    if (hmrWsTimeoutRef.current) {
      clearTimeout(hmrWsTimeoutRef.current);
      hmrWsTimeoutRef.current = null;
    }
    if (hmrWsRef.current) {
      try { hmrWsRef.current.close(); } catch { }
      hmrWsRef.current = null;
    }

    let settled = false;
    let opened = false;
    const settle = (next: 'ok' | 'unknown') => {
      if (settled) return;
      settled = true;
      setHmrWsStatus(next);
      if (hmrWsTimeoutRef.current) {
        clearTimeout(hmrWsTimeoutRef.current);
        hmrWsTimeoutRef.current = null;
      }
      const ws = hmrWsRef.current;
      hmrWsRef.current = null;
      if (ws) {
        try { ws.close(); } catch { }
      }
    };

    try {
      const ws = new WebSocket(wsUrl);
      hmrWsRef.current = ws;

      ws.onopen = () => {
        opened = true;
        settle('ok');
      };
      ws.onerror = () => {
        settle('unknown');
      };
      ws.onclose = () => {
        if (!opened) settle('unknown');
      };

      // Timeout: if it doesn't open quickly, treat as blocked.
      hmrWsTimeoutRef.current = setTimeout(() => settle('unknown'), 3000);
    } catch {
      settle('unknown');
    }

    return () => {
      if (hmrWsTimeoutRef.current) {
        clearTimeout(hmrWsTimeoutRef.current);
        hmrWsTimeoutRef.current = null;
      }
      if (hmrWsRef.current) {
        try { hmrWsRef.current.close(); } catch { }
        hmrWsRef.current = null;
      }
    };
  }, [previewUrl, (currentStatusData as any)?.appServerKind, externalPreviewMode]);

  // If the iframe has loaded and we later confirm HMR websocket health,
  // the preview is effectively interactive even if the backend `ready` flag lags.
  useEffect(() => {
    if (hmrWsStatus !== 'ok') return;
    if (!previewUrl) return;
    if (!iframeLoadedSuccessfullyRef.current) return;
    try { onPreviewReadyChange?.(true); } catch { }
  }, [hmrWsStatus, previewUrl, onPreviewReadyChange]);

  const hardReloadPreview = (reason: string) => {
    const base = proxyBaseRef.current || previewUrlRef.current;
    if (!base) return;
    console.log('[WebContainerRunner] hard reload preview', { appId, reason });
    setIframeKey((k) => k + 1);
    setPreviewUrl(withCacheBust(base));
  };

  // Workaround: HMR inside embedded hub previews can stop propagating even when the dev server recompiles.
  // When we detect next-dev + hub + preview already loaded, issue a hard reload after file edits.
  useEffect(() => {
    const currentUrl = previewUrlRef.current;
    if (!currentUrl) return;
    if (!iframeLoadedSuccessfullyRef.current) return;
    if (lastAppServerKindRef.current !== 'next-dev') return;
    if (!isHubPreviewUrl(String(currentUrl))) return;

    // If the HMR websocket is healthy, prefer letting HMR update the page.
    // The whole point of this workaround is when HMR is blocked/broken.
    if (hmrWsStatus === 'ok') return;

    const fileCount = Object.keys(files || {}).length;
    let maxModified = 0;
    try {
      for (const f of Object.values(files || {})) {
        const lm = Number((f as any)?.lastModified);
        if (Number.isFinite(lm)) maxModified = Math.max(maxModified, lm);
      }
    } catch {
      // ignore
    }
    const sig = `${fileCount}:${maxModified}`;

    if (!lastFilesSignatureRef.current) {
      lastFilesSignatureRef.current = sig;
      return;
    }
    if (sig === lastFilesSignatureRef.current) return;
    lastFilesSignatureRef.current = sig;

    if (autoReloadTimeoutRef.current) {
      clearTimeout(autoReloadTimeoutRef.current);
      autoReloadTimeoutRef.current = null;
    }

    // Give Next dev a moment to recompile before reloading, otherwise we often
    // reload into the *previous* build and the user needs to refresh again.
    const AUTO_HARD_RELOAD_DELAY_MS = 3000;
    autoReloadTimeoutRef.current = setTimeout(() => {
      autoReloadTimeoutRef.current = null;
      // Only reload if we still have a preview URL.
      if (!previewUrlRef.current) return;
      hardReloadPreview('files_changed');
    }, AUTO_HARD_RELOAD_DELAY_MS);

    return () => {
      if (autoReloadTimeoutRef.current) {
        clearTimeout(autoReloadTimeoutRef.current);
        autoReloadTimeoutRef.current = null;
      }
    };
  }, [appId, files, hmrWsStatus]);

  const withCacheBust = (url: string) => {
    const cb = String(Date.now());
    try {
      const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : undefined);
      // IMPORTANT: `t` is the viewer token (capability). Never overwrite it.
      u.searchParams.set('cb', cb);
      return u.toString();
    } catch {
      return url.includes('?') ? `${url}&cb=${cb}` : `${url}?cb=${cb}`;
    }
  };

  const withPreviewPath = (url: string, path: string) => {
    const raw = String(path || '').trim();
    if (!raw) return url;
    // Strip any accidental query/hash.
    const cleaned = raw.split('?')[0].split('#')[0];
    const normalized = ('/' + cleaned).replace(/\/+/g, '/').replace(/\s+/g, '');

    try {
      const u = new URL(url);
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs.length >= 2 && segs[0] === 'preview') {
        const base = `/${segs[0]}/${segs[1]}`;
        u.pathname = normalized === '/' ? base : `${base}${normalized}`;
        return u.toString();
      }
      return url;
    } catch {
      return url;
    }
  };

  const toPreviewRootUrl = (url: string) => {
    try {
      const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : undefined);
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs.length >= 2 && segs[0] === 'preview') {
        u.pathname = `/${segs[0]}/${segs[1]}`;
      }
      return u.toString();
    } catch {
      return url;
    }
  };

  const normalizeAppRouteFromPath = useCallback((path: string | null | undefined) => {
    const raw = String(path || '').trim();
    if (!raw) return '/';

    try {
      const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : undefined);
      const pathname = String(url.pathname || '/').replace(/\/+$/g, '') || '/';
      const parts = pathname.split('/').filter(Boolean);

      if (parts.length >= 2 && parts[0] === 'preview') {
        return `/${parts.slice(2).join('/')}`.replace(/\/+/g, '/') || '/';
      }

      if (parts.length >= 4 && parts[0] === 'api' && parts[1] === 'webcontainer' && parts[3] === 'proxy') {
        return `/${parts.slice(4).join('/')}`.replace(/\/+/g, '/') || '/';
      }

      return pathname || '/';
    } catch {
      return raw.startsWith('/') ? raw.replace(/\/+$/g, '') || '/' : `/${raw}`.replace(/\/+/g, '/') || '/';
    }
  }, []);

  const sendPreviewNavigateCommand = useCallback((path: string | null | undefined) => {
    if (typeof window === 'undefined') return;
    const raw = String(path || '').trim();
    if (!raw) return;
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'kloner:preview-navigate', pathname: raw },
        '*',
      );
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as any;
      if (!data || data.type !== 'kloner:preview-route') return;

      const nextPath = normalizeAppRouteFromPath(typeof data.pathname === 'string' ? data.pathname : null);
      if (!nextPath) return;
      onNavigatePathChange?.(nextPath);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [normalizeAppRouteFromPath, onNavigatePathChange]);

  // Track a stable base URL for reloads (strip only cache-busting params).
  useEffect(() => {
    if (!previewUrl) return;
    try {
      const isRelative = String(previewUrl).startsWith('/');
      const u = new URL(isRelative ? `${window.location.origin}${previewUrl}` : String(previewUrl));
      // IMPORTANT: keep `t` (viewer token). Only strip our cache-buster.
      u.searchParams.delete('cb');
      proxyBaseRef.current = toPreviewRootUrl(isRelative ? `${u.origin}${u.pathname}${u.search}${u.hash}` : u.toString());
    } catch {
      // Last-resort fallback: never strip query params (it may contain the viewer token `t`).
      const raw = String(previewUrl);
      proxyBaseRef.current = toPreviewRootUrl(raw.replace(/([?&])cb=[^&#]+(&)?/g, (m, sep, trailing) => (sep === '?' && trailing ? '?' : sep === '?' ? '' : trailing ? '&' : '')).replace(/[?&]$/, '') || raw);
    }
  }, [previewUrl]);

  // Allow the parent to ask the live preview to switch routes without reloading the iframe.
  useEffect(() => {
    if (typeof navigatePathToken !== 'number') return;
    if (navigatePathToken <= 0) return;
    if (lastNavigatePathTokenRef.current === navigatePathToken) return;

    if (!navigatePath) return;
    sendPreviewNavigateCommand(navigatePath);
    lastNavigatePathTokenRef.current = navigatePathToken;
  }, [navigatePath, navigatePathToken, sendPreviewNavigateCommand]);

  // If the parent requests a restart, we must actually tear down our local
  // "already started" guard and avoid reconnecting to a stale machine.
  useEffect(() => {
    if (typeof restartToken !== 'number') return;
    // Treat non-positive tokens as "no restart requested" (common default is 0).
    // This prevents an initial mount from being interpreted as a restart.
    if (restartToken <= 0) return;
    if (lastRestartTokenRef.current === restartToken) return;
    lastRestartTokenRef.current = restartToken;

    console.log('[WebContainerRunner] Restart requested', { appId, restartToken });

    // Reset state so the main start effect can run again.
    lastStartKeyRef.current = null;
    setIsLoading(false);
    setIsPolling(false);
    setConnectingToExisting(false);
    setPreviewUrl(null);
    previewUrlFirstSeenAtRef.current = 0;
    setError(null);
    setCanRetry(false);
    setLoadingStatus('');
    setCurrentStatusData(null);
    setPollNetworkWarning(null);

    pollingRetryCountRef.current = 0;
    containerNotFoundCountRef.current = 0;
    assetFailureCountRef.current = 0;
    appLoadedSuccessfullyRef.current = false;
    iframeLoadedSuccessfullyRef.current = false;
    pollingCodeRef.current = null;
    activePollCodeRef.current = null;
    previewRegistrationGraceUntilRef.current = 0;
    backendReadyRef.current = false;
    pollStartedAtRef.current = 0;
    pollFetchFailureCountRef.current = 0;
    lastPollIssueReportKeyRef.current = '';
    iframePostLoadRecoveryCountRef.current = 0;
    lastPreviewGenerationKeyRef.current = '';
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }
    latestDeploymentUrlRef.current = '';
    hubStatusUrlRef.current = null;
    lastReportedStatusRef.current = '';
  }, [appId, restartToken]);

  // Reconnect requested: re-run connection logic without restarting and without
  // creating a new machine if the existing one can't be reached.
  useEffect(() => {
    if (typeof reconnectToken !== 'number') return;
    if (reconnectToken <= 0) return;
    if (lastReconnectTokenRef.current === reconnectToken) return;
    lastReconnectTokenRef.current = reconnectToken;

    console.log('[WebContainerRunner] Reconnect requested', { appId, reconnectToken });
    reconnectOnlyRef.current = true;

    lastStartKeyRef.current = null;
    setIsLoading(false);
    setIsPolling(false);
    setConnectingToExisting(true);
    setPreviewUrl(null);
    previewUrlFirstSeenAtRef.current = 0;
    setError(null);
    setCanRetry(false);
    setLoadingStatus('');
    setCurrentStatusData(null);
    setPollNetworkWarning(null);

    pollingRetryCountRef.current = 0;
    containerNotFoundCountRef.current = 0;
    assetFailureCountRef.current = 0;
    appLoadedSuccessfullyRef.current = false;
    iframeLoadedSuccessfullyRef.current = false;
    pollingCodeRef.current = null;
    activePollCodeRef.current = null;
    previewRegistrationGraceUntilRef.current = 0;
    backendReadyRef.current = false;
    pollStartedAtRef.current = 0;
    pollFetchFailureCountRef.current = 0;
    lastPollIssueReportKeyRef.current = '';
    iframePostLoadRecoveryCountRef.current = 0;
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }
    latestDeploymentUrlRef.current = '';
    hubStatusUrlRef.current = null;
    lastReportedStatusRef.current = '';
    lastPreviewGenerationKeyRef.current = '';
  }, [appId, reconnectToken]);

  // Monitor app loading and surface persistent asset failures
  useEffect(() => {
    // Disable aggressive health checks for now - rely on iframe error handling
    return;

    if (!previewUrl || appLoadedSuccessfullyRef.current) return;

    // Delay health checks to allow app to stabilize first
    const healthCheckDelay = setTimeout(() => {
      // Perform periodic health checks to detect asset failures
      const healthCheckInterval = setInterval(async () => {
        if (!previewUrl || appLoadedSuccessfullyRef.current) return;

        try {
          // Try to fetch a critical asset to check if the app is serving properly
          const healthCheckUrl = `${previewUrl.replace(/\/$/, '')}/_next/static/css/app/layout.css`;
          const response = await fetch(healthCheckUrl, { method: 'HEAD' });

          if (response.status === 404) {
            console.log('Critical asset 404 detected, recording failure...');
            handleAssetFailure();
          } else if (response.ok) {
            // Reset failure count on successful asset fetch
            assetFailureCountRef.current = 0;
          }
        } catch (error: any) {
          // Ignore fetch errors, might be network issues
        }
      }, 10000); // Check every 10 seconds (less aggressive)

      return () => clearInterval(healthCheckInterval);
    }, 15000); // Wait 15 seconds before starting health checks

    return () => clearTimeout(healthCheckDelay);
  }, [previewUrl]);

  // Monitor iframe loading (disabled)
  useEffect(() => {
    // Disabled: superseded by the dedicated iframe load timeout effect below.
    // The old behavior could retry too aggressively even when the preview was reachable.
    return;
  }, [previewUrl]);

  useEffect(() => {
    const pending = pendingCleanupTimers.get(appId);
    if (typeof pending === 'number') {
      clearTimeout(pending);
      pendingCleanupTimers.delete(appId);
    }

    const runId = ++startRunIdRef.current;
    effectStartedAtRef.current = Date.now();

    const startApp = async () => {
      try {
        if (!filesReady) {
          console.log('⏳ Waiting for hydrated files before starting webcontainer');
          return;
        }

        // Reset duplicate-start guard if force fresh start is requested
        const isForceFreshStart = forceFreshStart && forceFreshStart > lastForceFreshStartRef.current;
        if (isForceFreshStart) {
          console.log('🔄 Force fresh start detected, resetting component state');
          lastForceFreshStartRef.current = forceFreshStart;
          lastStartKeyRef.current = null;
          setPreviewUrl(null);
          setError(null);
          setIsPolling(false);
          setIsLoading(false);
          appLoadedSuccessfullyRef.current = false;
          iframeLoadedSuccessfullyRef.current = false;
          pollingCodeRef.current = null;
          activePollCodeRef.current = null;
          previewRegistrationGraceUntilRef.current = 0;
          hubStatusUrlRef.current = null;
          latestDeploymentUrlRef.current = '';
          lastReportedStatusRef.current = '';
          lastBackendReadyNotifyRef.current = null;
          lastReadyUrlRef.current = null;
        }

        const startKey = `${appId}|${startAttempt}|${manualStartNonce}|${restartToken ?? 0}|${reconnectToken ?? 0}|${forceFreshStart ?? 0}`;
        if (lastStartKeyRef.current === startKey) {
          console.log('Already started, skipping duplicate startApp call');
          return;
        }
        lastStartKeyRef.current = startKey;

        setIsLoading(true);
        setError(null);
        setCompileErrorState(null);
        compileErrorActiveFingerprintRef.current = null;
        setIsPolling(false); // Reset polling state
        setPreviewUrl(null);
        setPollNetworkWarning(null);
        setConnectingToExisting(false);
        pollingRetryCountRef.current = 0; // Reset retry count
        containerNotFoundCountRef.current = 0; // Reset 404 counter
        pollFetchFailureCountRef.current = 0;
        lastPollFailureSignatureRef.current = '';
        repeatedPollFailureCountRef.current = 0;
        lastPollIssueReportKeyRef.current = '';
        hubStatusUrlRef.current = null;
        latestDeploymentUrlRef.current = '';
        lastReportedStatusRef.current = '';

        console.log('Starting app with ID:', appId);

        let reconnectOnly = reconnectOnlyRef.current;
        reconnectOnlyRef.current = false;

        // Handle force fresh start - delete existing container and create new one
        if (isForceFreshStart) {
          console.log('🔄 Force fresh start requested - deleting existing container and creating new one');

          // Get the stored container code so we can delete it
          const existingCode = await getStoredContainerCode(appId, user);
          if (existingCode) {
            console.log(`🗑️ Deleting existing container ${existingCode} before creating new one`);
            try {
              const headers = await getAuthenticatedHeaders();
              const deleteResponse = await fetch(`/api/webcontainer-delete?code=${existingCode}&appId=${appId}`, {
                method: 'DELETE',
                headers,
                credentials: "include"
              });

              if (deleteResponse.ok) {
                console.log(`✅ Successfully deleted container ${existingCode}`);
              } else {
                console.log(`⚠️ Failed to delete container ${existingCode}, but continuing with fresh start`);
              }
            } catch (error) {
              console.log(`⚠️ Error deleting container ${existingCode}:`, error);
              // Continue anyway - the container might already be gone
            }
          } else {
            console.log('ℹ️ No existing container code found to delete');
          }

          // Clear stored code and skip to container creation
          await clearStoredContainerCodeEverywhere(appId, user);

          // Skip existing container checks entirely - go straight to creation
          console.log(`🏗️ Force fresh start: Creating new container for app ${appId}...`);
          setLoadingStatus('Starting new machine... (This can take a minute or two)');
        } else {
          // First, check if there's an existing container for this app
          const existingCode = await getStoredContainerCode(appId, user);

          if (!existingCode && reconnectOnly) {
            console.log(`🔌 Reconnect requested but no stored container code found for app ${appId}; falling back to creating a new machine`);
            reconnectOnly = false;
            setConnectingToExisting(false);
            setError(null);
            setCanRetry(false);
          }

          if (existingCode) {
            console.log(`🔍 Found stored container code for app ${appId}: ${existingCode}`);
            setConnectingToExisting(true);
            setLoadingStatus('Connecting to existing machine...');

            try {
              const headers = await getAuthenticatedHeaders();
              const statusResponse = await fetch(`/api/webcontainer-status?code=${existingCode}&appId=${appId}`, {
                headers,
                credentials: "include"
              });
              if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                console.log(`🔍 Checking existing container ${existingCode}: status='${statusData.status}', progress=${statusData.uiProgress}%, url=${!!statusData.url}, machineId=${statusData.machineId || 'none'}`);
                const allowedStatuses = ['ready', 'running', 'compiled', 'started', 'completed', 'finished', 'active', 'online'];
                console.log(`ℹ️ Allowed statuses for direct connection: [${allowedStatuses.join(', ')}]`);

                // IMPORTANT: do NOT treat "stopped" as reusable even if it still has a URL.
                // A stopped Fly machine can continue to return a proxied/edge page that makes
                // the iframe look "loaded" while the app is actually dead.
                const isAllowedStatus = allowedStatuses.includes(statusData.status);

                if (isAllowedStatus) {
                  if (statusData.url) {
                    console.log(`✅ Existing container ${existingCode} is ready (${statusData.status}), probing before connecting:`, statusData.url);

                    // If we have a Fly machineId, treat Fly as source-of-truth.
                    // If Fly says the machine doesn't exist or isn't running/starting/started, do not reuse.
                    if (statusData.machineId) {
                      const fly = await isFlyMachineRunning(statusData.url, statusData.machineId);
                      if (!fly.ok) {
                        if (fly.reason === "not_found") {
                          console.log(
                            `🛫 Fly reports machine ${statusData.machineId} does not exist; clearing stored code for ${existingCode}.`
                          );
                          await clearStoredContainerCodeEverywhere(appId, user);
                          throw new Error("fly_machine_not_found");
                        }
                        // missing_token / unavailable -> fall back to URL probe
                      } else if (!fly.running) {
                        console.log(
                          `🛫 Fly reports machine ${statusData.machineId} is '${fly.state}', not reusable; clearing stored code for ${existingCode}.`
                        );
                        await clearStoredContainerCodeEverywhere(appId, user);
                        throw new Error("fly_machine_not_running");
                      }
                    }

                    const probe = await probePreviewUrl(appId, statusData.url);
                    if (probe.reachable) {
                      pollingCodeRef.current = existingCode;
                      setPreviewUrl(buildBrowserPreviewUrl(statusData.url));
                      setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                      setIsLoading(false);
                      backendReadyRef.current = true;
                      lastReadyUrlRef.current = statusData.url;
                      appLoadedSuccessfullyRef.current = true;
                      return; // Successfully connected to existing container
                    }

                    // If the probe says "not found", this is not transient.
                    if (probe.status === 404 || probe.status === 410) {
                      console.log(
                        `🗑️ Probe returned ${probe.status} for existing container ${existingCode}; clearing stored code and starting fresh.`
                      );
                      await clearStoredContainerCodeEverywhere(appId, user);
                      throw new Error("probe_not_found");
                    }

                    // IMPORTANT: a probe can fail transiently (hub cold start, brief DNS, Fly edge jitter).
                    // Do NOT clear stored code here. Attempt to load the iframe anyway.
                    console.log(`⚠️ Probe failed for existing container ${existingCode}; attempting to load preview anyway (keeping stored code).`);
                    pollingCodeRef.current = existingCode;
                    setPreviewUrl(buildBrowserPreviewUrl(statusData.url));
                    setLoadingStatus(`Connecting to machine ${statusData.machineId}…`);
                    setIsLoading(false);
                    backendReadyRef.current = true;
                    lastReadyUrlRef.current = statusData.url;
                    appLoadedSuccessfullyRef.current = true;
                    return;
                  } else {
                    console.log(`❌ Existing container ${existingCode} has allowed status '${statusData.status}' but no URL provided`);
                  }
                } else {
                  console.log(`❌ Existing container ${existingCode} status '${statusData.status}' not in allowed list: [${allowedStatuses.join(', ')}]`);

                  // For containers in error state, always clear them - never try to reconnect
                  if (statusData.status === 'error') {
                    console.log(`🗑️ Clearing stored code for error container ${existingCode} - will not attempt reconnection`);
                    await clearStoredContainerCodeEverywhere(appId, user);
                  } else if (statusData.status === 'stopped') {
                    // Backend sometimes reports "stopped" while Fly still shows the machine as started
                    // (e.g. stale status cache or mismatch across systems). If we can verify via Fly,
                    // prefer reuse (still gated by the server-side URL probe).
                    if (statusData.url && statusData.machineId) {
                      const flyState = await getFlyMachineState(statusData.url, statusData.machineId);
                      if (flyState.ok) {
                        console.log(`🛫 Fly machine state for ${statusData.machineId}:`, flyState.state);
                        const normalized = String(flyState.state || "").toLowerCase();
                        const explicitlyNotRunning = new Set([
                          "stopped",
                          "stopping",
                          "destroyed",
                          "destroying",
                          "dead",
                          "failed",
                        ]);
                        const flySaysRunning = normalized ? !explicitlyNotRunning.has(normalized) : true;
                        if (flySaysRunning) {
                          console.log(
                            `✅ Fly reports machine ${statusData.machineId} is '${flyState.state}', probing URL before reusing stopped container ${existingCode}`
                          );
                          const probe = await probePreviewUrl(appId, statusData.url);
                          if (probe.reachable) {
                            pollingCodeRef.current = existingCode;
                            setPreviewUrl(buildBrowserPreviewUrl(statusData.url));
                            setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                            setIsLoading(false);
                            appLoadedSuccessfullyRef.current = true;
                            return;
                          }
                          console.log(`❌ Probe failed despite Fly saying running; clearing stored code for ${existingCode}.`);
                        }
                      } else {
                        console.log(`ℹ️ Fly verification unavailable for stopped container (${flyState.reason}); falling back to clearing code.`);
                      }
                    }

                    console.log(`🗑️ Clearing stored code for stopped container ${existingCode} - will create a new machine`);
                    await clearStoredContainerCodeEverywhere(appId, user);
                  } else if (statusData.status === 'booting') {
                    console.log(`🗑️ Clearing stored code for booting container ${existingCode} - always create a new machine instead of reconnecting`);
                    await clearStoredContainerCodeEverywhere(appId, user);
                  } else {
                    console.log(`ℹ️ Container ${existingCode} (${statusData.status}, ${statusData.uiProgress}%) not ideal but has URL/machineId, will try fallback connection`);
                  }
                }

                // Try fallback connections for containers that have URL and machineId, regardless of status
                // (as long as they're not in error state)
                if (statusData.url && statusData.machineId && statusData.status !== 'error' && statusData.status !== 'stopped' && statusData.status !== 'booting') {
                  console.log(`🔄 Existing container ${existingCode} has URL and machineId (${statusData.machineId}), probing before fallback connect:`, statusData.url);

                  // Fly is the source of truth here.
                  const fly = await isFlyMachineRunning(statusData.url, statusData.machineId);
                  if (!fly.ok) {
                    if (fly.reason === "not_found") {
                      console.log(
                        `🛫 Fly reports machine ${statusData.machineId} does not exist; clearing stored code for ${existingCode}.`
                      );
                      await clearStoredContainerCodeEverywhere(appId, user);
                      throw new Error("fly_machine_not_found");
                    }
                    // If Fly check isn't available (missing token, etc), fall back to URL probe.
                  } else if (!fly.running) {
                    console.log(
                      `🛫 Fly reports machine ${statusData.machineId} is '${fly.state}', not reusable; clearing stored code for ${existingCode}.`
                    );
                    await clearStoredContainerCodeEverywhere(appId, user);
                    throw new Error("fly_machine_not_running");
                  }

                  const probe = await probePreviewUrl(appId, statusData.url);
                  if (probe.reachable) {
                    console.log(`✅ Probe succeeded for container ${existingCode} (${statusData.machineId})`);
                    pollingCodeRef.current = existingCode;
                    setPreviewUrl(buildBrowserPreviewUrl(statusData.url));
                    setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                    setIsLoading(false);
                    backendReadyRef.current = Boolean(statusData?.ready) || String(statusData?.status || '').toLowerCase() === 'ready';
                    if (backendReadyRef.current) lastReadyUrlRef.current = statusData.url;
                    appLoadedSuccessfullyRef.current = true;
                    return;
                  }

                  if (probe.status === 404 || probe.status === 410) {
                    console.log(
                      `🗑️ Probe returned ${probe.status} for container ${existingCode}; clearing stored code and starting fresh.`
                    );
                    await clearStoredContainerCodeEverywhere(appId, user);
                    throw new Error("probe_not_found");
                  }

                  // Same policy as above: do not discard the saved machine on a transient probe failure.
                  console.log(`⚠️ Probe failed for container ${existingCode}; attempting to load preview anyway (keeping stored code).`);
                  pollingCodeRef.current = existingCode;
                    setPreviewUrl(buildBrowserPreviewUrl(statusData.url));
                  setLoadingStatus(`Connecting to machine ${statusData.machineId}…`);
                  setIsLoading(false);
                  backendReadyRef.current = Boolean(statusData?.ready) || String(statusData?.status || '').toLowerCase() === 'ready';
                  if (backendReadyRef.current) lastReadyUrlRef.current = statusData.url;
                  appLoadedSuccessfullyRef.current = true;
                  return;
                } else {
                  console.log(`❌ Container ${existingCode} doesn't meet fallback conditions (status='${statusData.status}', progress=${statusData.uiProgress}%, url=${!!statusData.url}, machineId=${!!statusData.machineId})`);

                  // Clear stored codes for error containers without URLs - they're definitely unusable
                  if (statusData.status === 'error' && !statusData.url) {
                    console.log(`🗑️ Clearing stored code for unusable error container ${existingCode} (no URL)`);
                    await clearStoredContainerCodeEverywhere(appId, user);
                  }
                } // End of status !== 'booting' check
              } else if (statusResponse.status === 404) {
                console.log(`❌ Container ${existingCode} not found (404) - clearing invalid stored code`);
                await clearStoredContainerCodeEverywhere(appId, user);
                // 404 here usually means the saved preview code has expired or was deleted.
                // This is an expected condition; proceed to create a new machine.
                setConnectingToExisting(false);
                setLoadingStatus('Saved machine expired. Starting a new machine…');
              } else if (statusResponse.status >= 500) {
                // 5xx often means stale routing / dead saved machine / transient hub issue.
                // Retry briefly, then clear stale saved code and continue to fresh machine creation
                // instead of trapping the user in reconnect polling.
                console.log(
                  `⚠️ Status service error for container ${existingCode}: ${statusResponse.status} ${statusResponse.statusText}. Retrying briefly before fresh-machine fallback.`
                );

                const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
                let recovered = false;

                for (let attempt = 1; attempt <= 3; attempt += 1) {
                  if (startRunIdRef.current !== runId) return;

                  const waitMs = 800 * attempt;
                  await sleep(waitMs);

                  try {
                    const headers = await getAuthenticatedHeaders();
                    const res = await fetch(
                      `/api/webcontainer-status?code=${encodeURIComponent(existingCode)}&appId=${encodeURIComponent(appId)}`,
                      { method: 'GET', headers, credentials: 'include', cache: 'no-store' }
                    );

                    if (startRunIdRef.current !== runId) return;

                    if (res.status === 404 || res.status === 409 || res.status === 410) {
                      console.log(`🗑️ Saved container ${existingCode} became invalid during retry (${res.status}); clearing and creating fresh.`);
                      await clearStoredContainerCodeEverywhere(appId, user);
                      break;
                    }

                    if (!res.ok) continue;

                    const statusData = await res.json().catch(() => ({} as any));
                    const status = String((statusData as any)?.status || '').toLowerCase();
                    const url = String((statusData as any)?.url || '').trim();
                    const isReady =
                      status === 'ready' ||
                      ['running', 'compiled', 'started', 'online', 'active', 'completed', 'finished'].includes(status);

                    if (!url || !isReady) continue;

                    const probe = await probePreviewUrl(appId, url);
                    if (startRunIdRef.current !== runId) return;
                    if (!probe.reachable) {
                      if (probe.status === 404 || probe.status === 410) {
                        await clearStoredContainerCodeEverywhere(appId, user);
                        break;
                      }
                      continue;
                    }

                    console.log(`✅ Recovered saved machine ${existingCode} after transient status-service failure.`);
                    pollingCodeRef.current = existingCode;
                    iframeLoadedSuccessfullyRef.current = false;
                    setPreviewUrl(buildBrowserPreviewUrl(url));
                    setConnectingToExisting(false);
                    setIsPolling(false);
                    setIsLoading(false);
                    setError(null);
                    setCanRetry(false);
                    setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                    appLoadedSuccessfullyRef.current = true;
                    recovered = true;
                    return;
                  } catch {
                    // transient retry only
                  }
                }

                if (startRunIdRef.current !== runId) return;
                if (!recovered) {
                  console.log(`🧹 Saved machine ${existingCode} did not recover after status 5xx retries; clearing and starting fresh machine.`);
                  await clearStoredContainerCodeEverywhere(appId, user);
                  setConnectingToExisting(false);
                  setIsPolling(false);
                  setIsLoading(false);
                  setError(null);
                  setCanRetry(false);
                  setCurrentStatusData(null);
                  setLoadingStatus('Saved machine unavailable. Starting a fresh machine…');
                }
              } else {
                console.log(`❌ Failed to get status for container ${existingCode}: ${statusResponse.status} ${statusResponse.statusText}`);
              }
            } catch (err) {
              console.log(`❌ Failed to check status of existing container ${existingCode}, will create new one:`, err);
              if (reconnectOnly) {
                console.log(`🔌 Reconnect failed for ${existingCode}; falling back to creating a new machine`);
                reconnectOnly = false;
                setConnectingToExisting(false);
                setError(null);
                setCanRetry(false);
              }
              // Clear the stored code since it's not usable
              await clearStoredContainerCodeEverywhere(appId, user);
            }

            // If we get here, the existing container is not usable
            console.log(`🆕 No usable existing container found for app ${appId}, creating new one`);
            if (reconnectOnly) {
              reconnectOnly = false;
              setConnectingToExisting(false);
              setError(null);
              setCanRetry(false);
            }
            setConnectingToExisting(false);
            await clearStoredContainerCodeEverywhere(appId, user);
          } else {
            console.log(`ℹ️ No stored container code found for app ${appId}, creating new one`);
          }
        } // End of forceFreshStart else block

        if (reconnectOnly) {
          // Safety fallback: if reconnect mode is still set here, continue by creating a new machine.
          reconnectOnly = false;
          setConnectingToExisting(false);
          setError(null);
          setCanRetry(false);
        }

        // Create a new container (either force fresh start or no existing container found)
        if (isForceFreshStart) {
          console.log(`🏗️ Force fresh start: Creating new container for app ${appId}...`);
        } else {
          console.log(`🏗️ Creating new container for app ${appId}...`);
        }
        setLoadingStatus('Starting new machine... (This can take a minute or two)');

        // Validate files before sending
        if (!filesRef.current || typeof filesRef.current !== 'object' || Array.isArray(filesRef.current)) {
          console.error('Files validation failed:', {
            filesExists: !!filesRef.current,
            filesType: typeof filesRef.current,
            isArray: Array.isArray(filesRef.current),
            filesKeys: filesRef.current ? Object.keys(filesRef.current) : 'N/A'
          });
          throw new Error('Files object is invalid or missing');
        }

        // Ensure all file entries have the correct structure
        const validatedFiles: { [path: string]: any } = {};
        for (const [path, file] of Object.entries(filesRef.current)) {
          if (!file || typeof file !== 'object' || typeof file.content !== 'string') {
            console.error('Invalid file entry:', path, file);
            throw new Error(`Invalid file structure for ${path}`);
          }
          validatedFiles[path] = file;
        }

        // One-time: ensure jsconfig/tsconfig exists and has compilerOptions to avoid
        // Next dev bundler crashes (baseUrl read of undefined) which breaks HMR.
        // Persist via update-file so Firestore remains the source of truth.
        if (!ensuredConfigRef.current) {
          ensuredConfigRef.current = true;
          try {
            const { nextFiles, fixes } = ensureNextConfigFiles(validatedFiles);
            for (const f of fixes) {
              try {
                const headers = await getAuthenticatedHeaders();
                await fetch(`/api/app-builder/${encodeURIComponent(appId)}/update-file`, {
                  method: 'POST',
                  headers,
                  credentials: 'include',
                  cache: 'no-store',
                  body: JSON.stringify({ path: f.path, content: f.content }),
                });
              } catch {
                // best-effort; still include in the machine start payload
              }
            }
            // Replace payload files with the normalized set.
            for (const [p, v] of Object.entries(nextFiles)) {
              (validatedFiles as any)[p] = v;
            }
          } catch {
            // ignore
          }
        }

        // Ensure app scope cookie exists before privileged app-builder APIs.
        const ensureAppScopeCookie = async () => {
          try {
            await fetch(`/api/app-builder/${encodeURIComponent(appId)}/scope`, {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
            });
          } catch {
            // best-effort; request path below still handles scope retry
          }
        };

        // Start the webcontainer creation (async, fire-and-forget)
        const requestBody = { appId, files: validatedFiles, mode: 'dev' };
        const estimatedRequestBytes = (() => {
          try {
            const encoded = new TextEncoder().encode(JSON.stringify(requestBody));
            return encoded.byteLength;
          } catch {
            return 0;
          }
        })();

        const serverHydrateFallbackEnabled = (() => {
          const raw = String(process.env.NEXT_PUBLIC_WEB_PREVIEW_SERVER_HYDRATE_FALLBACK || '').trim().toLowerCase();
          return raw === '1' || raw === 'true';
        })();

        const serverHydrateThresholdBytes = (() => {
          const raw = Number.parseInt(String(process.env.NEXT_PUBLIC_WEB_PREVIEW_SERVER_HYDRATE_THRESHOLD_BYTES || '').trim(), 10);
          if (Number.isFinite(raw) && raw > 0) return raw;
          // Conservative default below typical serverless payload limits.
          return 4_000_000;
        })();

        const shouldPreferServerHydrate =
          serverHydrateFallbackEnabled &&
          estimatedRequestBytes >= serverHydrateThresholdBytes;

        const serverHydrateRequestBody: Record<string, unknown> = {
          appId,
          mode: 'dev',
          startupStrategy: 'hydrate_server_files',
          fallbackReason: 'payload_threshold_exceeded',
          estimatedRequestBytes,
        };

        const formatMb = (bytes: number) => {
          if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
          return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        };

        const postWebcontainer = async (attempt: number, body: Record<string, unknown>): Promise<Response> => {
          const headers = await getAuthenticatedHeaders();
          return fetch('/api/webcontainer', {
            method: 'POST',
            headers,
            credentials: "include",
            cache: 'no-store',
            body: JSON.stringify(body),
          });
        };

        const reportStartupContractIssue = (key: string, payload: {
          action: string;
          severity: 'critical' | 'error' | 'warning' | 'info';
          statusCode?: number;
          reason: string;
          message: string;
          force?: boolean;
        }) => {
          void reportPreviewAlert({
            appId,
            code: pollingCodeRef.current || undefined,
            action: payload.action,
            severity: payload.severity,
            statusCode: payload.statusCode,
            status: 'webcontainer_startup',
            reason: payload.reason,
            message: payload.message,
            elapsedMs: pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined,
            previewUrl: previewUrlRef.current,
            backendStatusData: lastBackendStatusRef.current,
            alertKeyOverride: key,
            dedupeTtlMs: 60 * 1000,
            force: payload.force,
          });
        };

        await ensureAppScopeCookie();
        let activeRequestBody: Record<string, unknown> = requestBody;
        if (shouldPreferServerHydrate) {
          console.info('[WebContainerRunner] trying server-hydrated startup fallback', {
            appId,
            estimatedRequestBytes,
            thresholdBytes: serverHydrateThresholdBytes,
          });
          activeRequestBody = serverHydrateRequestBody;
        }

        let response = await postWebcontainer(0, activeRequestBody);

        if (!response.ok && shouldPreferServerHydrate && activeRequestBody === serverHydrateRequestBody) {
          const fallbackData = await response.clone().json().catch(() => ({} as any));
          const fallbackCode = String(fallbackData?.code || '').toLowerCase();
          const fallbackError = String(fallbackData?.error || '').toLowerCase();
          const backendHydrationUnsupported =
            response.status === 400 ||
            response.status === 404 ||
            response.status === 422 ||
            response.status === 501 ||
            fallbackCode.includes('unsupported') ||
            fallbackCode.includes('invalid_request') ||
            fallbackCode.includes('missing_files') ||
            fallbackError.includes('invalid request') ||
            fallbackError.includes('missing files') ||
            fallbackError.includes('unsupported startupstrategy');

          if (backendHydrationUnsupported) {
            console.warn('[WebContainerRunner] backend server-hydrate startup not available yet; retrying legacy full-files startup', {
              appId,
              status: response.status,
              code: fallbackData?.code || null,
            });
            reportStartupContractIssue(`startup-hydrate-unsupported-fallback:${appId}:${runId}`, {
              action: 'preview_start_server_hydrate_unsupported_fallback',
              severity: 'error',
              statusCode: response.status,
              reason: 'server_hydrate_unsupported',
              message: 'Server-hydrated preview startup is not supported by backend yet. Falling back to legacy full-files startup.',
            });
            activeRequestBody = requestBody;
            response = await postWebcontainer(0, activeRequestBody);
          }
        }

        if (!response.ok && response.status === 413 && serverHydrateFallbackEnabled && activeRequestBody === requestBody) {
          console.warn('[WebContainerRunner] startup hit HTTP 413; attempting server-hydrated startup fallback', {
            appId,
            estimatedRequestBytes,
          });
          reportStartupContractIssue(`startup-413-fallback-attempt:${appId}:${runId}`, {
            action: 'preview_start_413_fallback_attempt',
            severity: 'error',
            statusCode: 413,
            reason: 'request_payload_too_large',
            message: 'Preview startup payload hit HTTP 413. Attempting server-hydrated startup fallback.',
            force: true,
          });
          activeRequestBody = serverHydrateRequestBody;
          response = await postWebcontainer(0, activeRequestBody);
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as any));
          const errorMsg = String(errorData?.error || 'Failed to start app');
          const errorCode = String(errorData?.code || '').trim();
          const lowerCode = errorCode.toLowerCase();
          const lowerMsg = errorMsg.toLowerCase();
          const isTooLargeLikeError =
            response.status === 413 ||
            lowerCode.includes('too_large') ||
            lowerCode.includes('payload_too_large') ||
            lowerCode.includes('request_too_large') ||
            lowerCode.includes('entity_too_large') ||
            lowerCode.includes('function_payload_too_large') ||
            lowerMsg.includes('payload too large') ||
            lowerMsg.includes('request entity too large') ||
            lowerMsg.includes('function_payload_too_large');
          const isCriticalHttpStartupFailure = response.status >= 500;

          if (isTooLargeLikeError || isCriticalHttpStartupFailure) {
            reportStartupContractIssue(
              `startup-critical-http:${appId}:${runId}:${response.status}:${errorCode || 'no-code'}`,
              {
                action: isTooLargeLikeError
                  ? 'preview_start_payload_too_large'
                  : 'preview_start_critical_http_failure',
                severity: isTooLargeLikeError ? 'error' : 'critical',
                statusCode: response.status,
                reason: isTooLargeLikeError ? 'request_payload_too_large' : 'startup_http_failure',
                message: `Preview startup failed with HTTP ${response.status}${errorCode ? ` (${errorCode})` : ''}: ${errorMsg}`,
              },
            );
          }

          const isScopeProblem =
            errorCode === 'MISSING_APP_SCOPE' ||
            errorCode === 'INVALID_APP_SCOPE' ||
            errorMsg.toLowerCase().includes('app scope');

          // CSRF can drift (cookie/header mismatch). Refresh token and retry once.
          if (response.status === 403 && errorMsg.toLowerCase().includes('csrf')) {
            console.warn('Webcontainer start hit CSRF 403; retrying once with fresh CSRF token');
            response = await postWebcontainer(1, activeRequestBody);
          } else if (response.status === 403 && isScopeProblem) {
            console.warn('Webcontainer start hit app-scope 403; refreshing scope cookie and retrying once');
            await ensureAppScopeCookie();
            response = await postWebcontainer(1, activeRequestBody);
          } else if (response.status === 413) {
            throw new Error(
              `Preview payload too large (HTTP 413). The generated app payload is about ${formatMb(estimatedRequestBytes)} and exceeds the API/request limit. Remove large assets or split content before retrying.`
            );
          } else {
            throw new Error(errorMsg);
          }
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as any));
          const errorMsg = String(errorData?.error || 'Failed to start app');
          if (response.status === 413) {
            throw new Error(
              `Preview payload too large (HTTP 413). The generated app payload is about ${formatMb(estimatedRequestBytes)} and exceeds the API/request limit. Remove large assets or split content before retrying.`
            );
          }
          throw new Error(errorMsg);
        }

        const data = await response.json();
        console.log('Container creation response:', data);
        const { code } = data;

        if (!code) {
          throw new Error('No tracking code received from server');
        }

        console.log('App creation started, tracking code:', code);
        pollingCodeRef.current = code;
        activePollCodeRef.current = code;
        previewRegistrationGraceUntilRef.current = Date.now() + (isForceFreshStart ? 4 * 60_000 : 2 * 60_000);

        // Store the container code for future connections
        await storeContainerCode(appId, code, user);

        setIsPolling(true); // Enter polling state
        setLoadingStatus(''); // Clear loading status when entering polling state
        pollingRetryCountRef.current = 0; // Reset retry count
        containerNotFoundCountRef.current = 0; // Reset 404 counter

        // Start polling for status
        const pollStatus = async () => {
          if (startRunIdRef.current !== runId) return; // Component was unmounted

          // Guard against stale polling loops from older starts that can keep hitting
          // an old preview code while a fresh machine is warming up.
          const activeCode = activePollCodeRef.current || pollingCodeRef.current;
          if (activeCode && activeCode !== code) {
            console.warn('[WebContainerRunner] Ignoring stale poll loop (code mismatch)', {
              appId,
              staleCode: code,
              activeCode,
            });
            return;
          }

          // Hard timeout guard (12 minutes)
          if (pollStartedAtRef.current && Date.now() - pollStartedAtRef.current > HARD_POLL_TIMEOUT_MS) {
            // If we already have a live preview surface, a strict polling timeout can
            // be a false negative (backend `ready` flag lagging behind real reachability).
            // Keep polling quietly instead of surfacing a terminal error.
            const hasLoadedPreviewSurface = Boolean(previewUrlRef.current) &&
              (appLoadedSuccessfullyRef.current || iframeLoadedSuccessfullyRef.current);
            if (hasLoadedPreviewSurface) {
              pollStartedAtRef.current = Date.now();
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
              return;
            }

            console.error('[WebContainerRunner] Preview polling timed out');
            const timedOutAgeMs = Date.now() - pollStartedAtRef.current;
            const online = typeof navigator !== 'undefined' ? navigator.onLine : null;
            const suspectedInterference = pollFetchFailureCountRef.current >= 3 && online !== false;
            const timeoutReportKey = `hard-timeout:${appId}:${code}`;
            const timeoutContext = extractTimeoutBackendContext(currentStatusData || lastBackendStatusRef.current || null);
            if (lastTimeoutReportKeyRef.current !== timeoutReportKey) {
              lastTimeoutReportKeyRef.current = timeoutReportKey;
              void reportPreviewTimeout({
                appId,
                code,
                status: 'poll_timeout',
                reason: suspectedInterference
                  ? 'poll_timeout_network_interference_suspected'
                  : 'poll_timeout',
                message: suspectedInterference
                  ? `Preview polling exceeded 12-minute timeout after repeated fetch failures while connecting to machine ${timeoutContext.machineId || 'unknown'}; privacy extension/adblock/VPN interference is suspected.`
                  : `Preview polling exceeded 12-minute hard timeout in WebContainerRunner${timeoutContext.machineId ? ` while connecting to machine ${timeoutContext.machineId}` : ''}.`,
                ageMs: timedOutAgeMs,
                previewUrl: previewUrlRef.current,
                browser: detectBrowserLabel(),
                userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : 'unknown',
                requestId: timeoutContext.requestId || undefined,
                jobId: timeoutContext.jobId || undefined,
                backend: timeoutContext.backend,
              });
            }
            stopAllTimers();
            setIsPolling(false);
            setIsLoading(false);
            setConnectingToExisting(false);
            setLoadingStatus('');
            setCurrentStatusData(null);
            setError(`Preview is taking longer than expected${timeoutContext.machineId ? ` while connecting to machine ${timeoutContext.machineId}` : ''} (12 minute timeout). Try Refresh first, if it still fails, please contact support.`);
            setCanRetry(true);
            return;
          }

          try {
            // Global throttle: ensure we don't issue status requests too frequently
            // even if multiple timers/paths accidentally converge.
            {
              const now = Date.now();
              const last = lastStatusFetchAtRef.current || 0;
              const waitForThrottle = Math.max(0, MIN_STATUS_FETCH_INTERVAL_MS - (now - last));
              if (waitForThrottle > 0) await new Promise((r) => setTimeout(r, waitForThrottle));
              lastStatusFetchAtRef.current = Date.now();
            }

            let statusResponse: Response | null = null;
            // Keep all browser polling on the same-origin backend route boundary.
            hubStatusUrlRef.current = null;
            const headers = await getAuthenticatedHeaders();
            statusResponse = await fetch(`/api/webcontainer-status?code=${code}&appId=${appId}`, {
              headers,
              credentials: "include",
              cache: 'no-store',
            });

            if (!statusResponse.ok) {
              if (statusResponse.status === 429) {
                pollRateLimitCountRef.current += 1;
                const rateData = await statusResponse.clone().json().catch(() => ({} as any));
                const retryAfterMs = parseRetryAfterMs(statusResponse.headers.get('retry-after'));
                const retryAfterFromBodyMs = (() => {
                  const n = Number((rateData as any)?.retryAfterSeconds);
                  if (!Number.isFinite(n) || n <= 0) return 0;
                  return Math.round(n * 1000);
                })();
                const elapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined;
                const nextDelay = Math.max(
                  30_000,
                  Math.min(15 * 60_000, Math.max(retryAfterMs || 0, retryAfterFromBodyMs || 0)),
                  getPollBackoffMs(pollRateLimitCountRef.current + 4),
                );

                reportPollIssueOnce(`poll-rate-limited:${appId}:${String((rateData as any)?.scope || 'global')}`, {
                  appId,
                  code,
                  action: 'preview_backend_rate_limited',
                  severity: 'critical',
                  statusCode: 429,
                  status: 'rate_limited',
                  reason: String((rateData as any)?.reason || (rateData as any)?.code || 'rate_limited').toLowerCase(),
                  message: 'Preview backend responded with rate limit while polling status.',
                  elapsedMs,
                  previewUrl: previewUrlRef.current,
                  requestId: String((rateData as any)?.requestId || '').trim() || undefined,
                  jobId: String((rateData as any)?.jobId || '').trim() || undefined,
                  alertKeyOverride: `rate_limited:${user?.uid || 'anonymous'}:${appId}:${String((rateData as any)?.scope || 'global').toLowerCase()}`,
                  dedupeTtlMs: 15 * 60 * 1000,
                  backendStatusData: {
                    status: 'rate_limited',
                    uiStage: String((rateData as any)?.scope || 'global').trim().toLowerCase(),
                    debug: {
                      timeoutReason: String((rateData as any)?.reason || (rateData as any)?.code || 'rate_limited').trim().toLowerCase(),
                      machine: {
                        state: (rateData as any)?.scope ?? null,
                        restartCount: null,
                      },
                      compile: {
                        summary: null,
                      },
                      storage: {
                        rootfsIoCorruption: null,
                      },
                    },
                  },
                });

                setLoadingStatus('Preview is still starting...');
                setCurrentStatusData((prev: any) =>
                  prev && typeof prev === 'object'
                    ? {
                        ...prev,
                        updatedAt: Date.now(),
                        uiMessage: 'Preview polling paused. Please refresh',
                      }
                    : {
                        status: 'rate_limited',
                        uiStage: 'rate_limited',
                        uiTitle: 'Rate limited',
                        uiMessage: 'Preview polling paused. Please refresh',
                        uiProgress: 0,
                        updatedAt: Date.now(),
                      }
                );
                stopAllTimers();
                setIsPolling(false);
                setIsLoading(false);
                setConnectingToExisting(false);
                setError(`Preview polling was rate-limited (429). Please wait about ${Math.max(30, Math.round(nextDelay / 1000))}s and click Refresh.`);
                setCanRetry(true);
                return;
              }

              if (statusResponse.status === 410) {
                const stalePreviewData = await statusResponse.json().catch(() => ({} as any));
                const stalePreviewStatusData = normalizeStatusDataForUi(code, {
                  ...stalePreviewData,
                  status: 'gone',
                  backendStatus: 'gone',
                  uiStage: 'preview_replaced_or_deleted',
                  uiTitle: pickFirstString(stalePreviewData?.uiTitle, 'Preview replaced or deleted'),
                  uiMessage: pickFirstString(
                    stalePreviewData?.uiMessage,
                    'This preview code is no longer valid. Refresh to reopen the latest preview or reopen the latest preview from the app shell.',
                  ),
                  suggestedFix: pickFirstString(
                    stalePreviewData?.suggestedFix,
                    stalePreviewData?.diagnostic?.suggestedFix,
                    stalePreviewData?.previewFailure?.suggestedFix,
                    'Refresh or reopen the latest preview to create a new valid preview code.',
                  ),
                  __httpStatus: 410,
                  httpStatus: 410,
                });
                const stalePreviewFailure = normalizePreviewFailureDetails(stalePreviewStatusData);

                console.log(`🗑️ Preview code ${code} is stale (410); clearing stored code and asking the user to refresh.`);
                if (stalePreviewFailure.requestId || stalePreviewFailure.correlationIds.length) {
                  console.log('[WebContainerRunner] stale preview diagnostics', {
                    requestId: stalePreviewFailure.requestId,
                    correlationIds: stalePreviewFailure.correlationIds,
                    backendStatus: stalePreviewFailure.backendStatus,
                    uiStage: stalePreviewFailure.uiStage,
                  });
                }

                await clearStoredContainerCodeEverywhere(appId, user);
                stopAllTimers();
                setIsPolling(false);
                setIsLoading(false);
                setConnectingToExisting(false);
                setLoadingStatus('Preview replaced or deleted. Refresh to reopen the latest preview.');
                setPreviewUrl(null);
                setCurrentStatusData(stalePreviewStatusData);
                setCanRetry(true);
                setError('Preview replaced or deleted. Refresh to reopen the latest preview or reopen the latest preview from the app shell.');

                reportPollIssueOnce(`stale-preview-code:${appId}:${code}:${stalePreviewFailure.requestId || 'unknown'}`, {
                  appId,
                  code,
                  action: 'preview_code_invalidated',
                  severity: 'warning',
                  statusCode: 410,
                  status: 'preview_replaced_or_deleted',
                  reason: 'preview_code_no_longer_valid',
                  message: 'The backend returned 410 Gone for this preview code. The latest preview must be reopened or refreshed.',
                  previewUrl: previewUrlRef.current,
                  requestId: stalePreviewFailure.requestId || undefined,
                  jobId: stalePreviewFailure.correlationIds.find((entry) => entry.label === 'jobId')?.value,
                  backendStatusData: stalePreviewStatusData,
                  correlationIds: stalePreviewFailure.correlationIds,
                });

                return;
              }

              // Handle 404s specially for newly created containers
              if (statusResponse.status === 404) {
                containerNotFoundCountRef.current += 1;
                const now = Date.now();
                const inRegistrationGrace = previewRegistrationGraceUntilRef.current > now;
                const baseMaxNotFoundAttempts = isForceFreshStart
                  ? Math.max(maxContainerNotFound, 15)
                  : Math.max(maxContainerNotFound, 15);
                const maxNotFoundAttempts = inRegistrationGrace
                  ? Math.max(baseMaxNotFoundAttempts, 15)
                  : baseMaxNotFoundAttempts;
                console.log(`Container not found (404) - attempt ${containerNotFoundCountRef.current}/${maxNotFoundAttempts}`);

                // Provide a helpful UI status while waiting for the backend to register the preview.
                // (404 during the first ~seconds is expected; do not treat as fatal yet.)
                setCurrentStatusData(
                  normalizeStatusDataForUi(code, {
                    uiStage: 'registering_preview',
                    uiTitle: 'Starting preview',
                    uiMessage: 'Waiting for the preview to come online…',
                    updatedAt: Date.now(),
                    status: 'starting',
                    uiProgress: 0,
                  })
                );

                if (containerNotFoundCountRef.current >= maxNotFoundAttempts) {
                  console.log('Too many 404s, giving up on this container');
                  setIsPolling(false);
                  setIsLoading(false);
                  setConnectingToExisting(false);
                  setError('Container failed to start after repeated 404s. Refresh first to retry this preview. If it still fails, use Rebuild to start a new machine.');
                  setCanRetry(true);
                  setLoadingStatus('');
                  setCurrentStatusData(null);
                  setPreviewUrl(null);
                  // Clear the stored code since it's not working
                  await clearStoredContainerCodeEverywhere(appId, user);
                  return;
                }

                // For 404s, retry more frequently since the container might not be registered yet
                statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
                return;
              }
              throw new Error(`Status check failed: ${statusResponse.status}`);
            }

            const statusDataRaw = await statusResponse.json().catch(() => ({} as any));
            const statusData = normalizeStatusDataForUi(code, statusDataRaw);
            lastBackendStatusRef.current = statusData;
            if (process.env.NODE_ENV !== 'production') {
              try {
                const status = String((statusData as any)?.status || '').toLowerCase();
                const uiStage = String((statusData as any)?.uiStage || '').toLowerCase();
                const ready = Boolean((statusData as any)?.ready);
                const progress = (statusData as any)?.uiProgress;
                console.log('[WebContainerRunner] preview poll tick', {
                  appId,
                  code,
                  status,
                  uiStage,
                  ready,
                  progress,
                  machineId: (statusData as any)?.machineId,
                });

                if (uiStage && uiStage !== lastUiStageRef.current) {
                  console.log('[WebContainerRunner] uiStage transition', {
                    appId,
                    code,
                    from: lastUiStageRef.current,
                    to: uiStage,
                  });
                  lastUiStageRef.current = uiStage;
                }

                if (status && status !== lastStatusRef.current) {
                  console.log('[WebContainerRunner] status transition', {
                    appId,
                    code,
                    from: lastStatusRef.current,
                    to: status,
                  });
                  lastStatusRef.current = status;
                }
              } catch {
                // ignore telemetry failures
              }
            }

            // Reset 404 counter on successful response
            containerNotFoundCountRef.current = 0;
            pollFetchFailureCountRef.current = 0;
            pollRateLimitCountRef.current = 0;
            lastPollFailureSignatureRef.current = '';
            repeatedPollFailureCountRef.current = 0;
            setPollNetworkWarning(null);

            // Store the status data for UI display
            setCurrentStatusData(statusData);

            const status = String((statusData as any)?.status || '').toLowerCase();
            const uiStage = String((statusData as any)?.uiStage || '').toLowerCase();
            const phase = String((statusData as any)?.phase || '').trim().toLowerCase();
            const step = String((statusData as any)?.step || '').trim().toLowerCase();
            const attachableFlag = Boolean((statusData as any)?.attachable);
            const restartPendingFlag = Boolean((statusData as any)?.restartPending || (statusData as any)?.queued || (statusData as any)?.outcome === 'restart_pending');
            const restartConfirmedFlag = Boolean((statusData as any)?.restartConfirmed);
            const activeRestartSignal = restartPendingFlag && !restartConfirmedFlag;
            const readyByLifecycle = phase === 'ready' || restartConfirmedFlag;
            const phaseTimedOut = phase === 'timeout';
            const phaseFailed = phase === 'failed';
            const readyFlag = Boolean((statusData as any)?.ready || readyByLifecycle);
            const retryableFlag = Boolean((statusData as any)?.retryable || (statusData as any)?.retryAfterSeconds != null || (statusData as any)?.retry_after_seconds != null);
            const retryAfterSeconds = asRetryAfterSeconds((statusData as any)?.retryAfterSeconds ?? (statusData as any)?.retry_after_seconds ?? null);
            const backendSignal = classifyBackendSignal(statusData);
            const deploymentUrlRaw = String((statusData as any)?.url || '').trim();
            const deploymentUrl = deploymentUrlRaw ? normalizePreviewUrlHost(deploymentUrlRaw) : '';
            const browserDeploymentUrl = buildBrowserPreviewUrl(deploymentUrl || latestDeploymentUrlRef.current || null);
            const flyMachineCreateFailure = getFlyMachineCreateFailure(statusData);
            const appServerKindRaw = String((statusData as any)?.appServerKind || '').toLowerCase();
            const appServerKind = (appServerKindRaw === 'fallback' || appServerKindRaw === 'next-dev' || appServerKindRaw === 'next-prod')
              ? (appServerKindRaw as any)
              : '';

            lastAppServerKindRef.current = appServerKind;

            const hasMachineId = Boolean(String((statusData as any)?.machineId || '').trim());
            const isBootingWithoutMachine =
              !readyFlag &&
              !deploymentUrl &&
              !hasMachineId &&
              ['pending', 'starting', 'booting', 'creating_machine', 'creating_server', 'transitioning'].includes(status);

            if (isBootingWithoutMachine) {
              if (noMachineBootSinceRef.current == null) {
                noMachineBootSinceRef.current = Date.now();
              }

              const bootElapsedMs = Date.now() - noMachineBootSinceRef.current;
              const bootTimeoutMs = uiStage === 'app_unreachable' ? 45_000 : 120_000;
              if (bootElapsedMs >= bootTimeoutMs) {
                reportPollIssueOnce(`no-machine-boot-timeout:${appId}:${code}:${uiStage || status || 'unknown'}`, {
                  appId,
                  code,
                  action: 'preview_no_machine_timeout',
                  severity: 'critical',
                  statusCode: 504,
                  status: 'no_machine_boot_timeout',
                  reason: uiStage || status || 'no_machine_boot_timeout',
                  message: 'Preview never produced a machine or URL, so the boot loop was stopped to avoid hanging forever.',
                  elapsedMs: bootElapsedMs,
                  previewUrl: previewUrlRef.current,
                  requestId: (statusData as any)?.requestId,
                  jobId: (statusData as any)?.jobId,
                  backendStatusData: statusData,
                });

                await clearStoredContainerCodeEverywhere(appId, user);
                stopAllTimers();
                setIsPolling(false);
                setIsLoading(false);
                setConnectingToExisting(false);
                setLoadingStatus('');
                setCurrentStatusData(null);
                setPreviewUrl(null);
                setError('Preview startup failed before a machine was created. Please refresh or rebuild.');
                setCanRetry(true);
                return;
              }
            } else {
              noMachineBootSinceRef.current = null;
            }

            // Fly provider can return a machine-create timeout (HTTP 408) after we already got a preview code.
            // Only treat it as terminal when the backend has not already declared an attachable or recoverable state.
            if (!readyFlag && !attachableFlag && !restartPendingFlag && !retryableFlag && flyMachineCreateFailure && flyMachineCreateFailure.status === 408) {
              reportPollIssueOnce(`fly-machine-create-timeout:${appId}:${code}`, {
                appId,
                code,
                action: 'preview_machine_create_timeout',
                severity: 'critical',
                statusCode: 500,
                status: 'machine_create_timeout',
                reason: 'fly_machine_create_timeout',
                message: 'Preview machine creation timed out at Fly provider after preview code issuance; triggering fresh restart.',
                elapsedMs: pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined,
                previewUrl: previewUrlRef.current,
                requestId: flyMachineCreateFailure.requestId,
                backendStatusData: statusData,
              });

              await clearStoredContainerCodeEverywhere(appId, user);
              stopAllTimers();

              setIsPolling(false);
              setConnectingToExisting(false);
              setPreviewUrl(null);
              setError(null);
              setCanRetry(false);
              setCurrentStatusData(
                normalizeStatusDataForUi(code, {
                  status: 'starting',
                  uiStage: 'creating_machine',
                  uiTitle: 'Restarting preview',
                  uiMessage: 'Machine startup timed out at the provider. Retrying on a fresh machine…',
                  uiProgress: 0,
                  updatedAt: Date.now(),
                })
              );
              setLoadingStatus('Restarting preview on a fresh machine…');
              setIsLoading(true);

              const syntheticPreviewUrl = `https://${CUSTOM_PREVIEW_HOST || DEFAULT_HUB_HOST}/preview/${encodeURIComponent(code)}`;
              requestForceFreshRebuild('fly_machine_create_timeout', syntheticPreviewUrl);
              return;
            }

            if (!readyFlag && !attachableFlag && !restartPendingFlag && !retryableFlag && backendSignal.hardFailure) {
              const elapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined;
              reportPollIssueOnce(`backend-hard-failure:${appId}:${code}:${backendSignal.timeoutReason || backendSignal.uiStage || backendSignal.status || 'unknown'}`, {
                appId,
                code,
                action: 'preview_backend_hard_failure',
                severity: 'critical',
                statusCode: 504,
                status: 'backend_hard_failure',
                reason: backendSignal.timeoutReason || backendSignal.uiStage || backendSignal.status || 'backend_hard_failure',
                message: 'Backend signaled an unrecoverable preview startup failure before iframe readiness.',
                elapsedMs,
                previewUrl: previewUrlRef.current,
                requestId: backendSignal.requestId,
                jobId: backendSignal.jobId,
                backendStatusData: statusData,
              });

              await clearStoredContainerCodeEverywhere(appId, user);
              stopAllTimers();
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setLoadingStatus('');
              setPreviewUrl(null);
              setError('Preview startup failed before the app became reachable.');
              setCanRetry(true);
              return;
            }

            if (!readyFlag && !attachableFlag && (phaseFailed || phaseTimedOut)) {
              stopAllTimers();
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setLoadingStatus('');
              setPreviewUrl(null);
              setCanRetry(true);
              setError(
                phaseTimedOut
                  ? 'Preview restart timed out. Please click Refresh to retry.'
                  : 'Preview restart failed. Please click Refresh to retry.',
              );
              setCurrentStatusData(
                normalizeStatusDataForUi(code, {
                  ...statusData,
                  status: status || 'error',
                  uiStage: uiStage || step || phase || 'error',
                  uiTitle: phaseTimedOut ? 'Preview restart timed out' : 'Preview restart failed',
                  uiMessage: phaseTimedOut
                    ? 'The restart did not complete in time. Try refresh to retry.'
                    : 'The restart did not complete successfully. Try refresh to retry.',
                  updatedAt: Date.now(),
                }),
              );
              return;
            }

            const applyPhase = phase === 'accepted' || phase === 'applying_files' || phase === 'files_applied';
            const queueRestartPhase = phase === 'restart_pending';
            const restartingPhase = phase === 'restarting' || activeRestartSignal;

            if (!readyFlag && !attachableFlag && (applyPhase || queueRestartPhase || restartingPhase)) {
              const delayMs = retryAfterSeconds !== null ? Math.max(1_000, retryAfterSeconds * 1000) : POLL_INTERVAL_MS;
              const phaseMessage = applyPhase
                ? 'Applying changes…'
                : queueRestartPhase
                  ? 'Queuing restart…'
                  : retryAfterSeconds !== null
                    ? `Restarting preview… retrying in ${retryAfterSeconds}s…`
                    : 'Restarting preview…';

              setError(null);
              setCanRetry(false);
              setIsLoading(true);
              setConnectingToExisting(false);
              setIsPolling(true);
              setLoadingStatus(phaseMessage);
              setCurrentStatusData((current: any) =>
                current && typeof current === 'object'
                  ? {
                    ...current,
                    ...statusData,
                    status: status || current.status || 'starting',
                    uiStage: uiStage || step || phase || current.uiStage || 'starting',
                    uiTitle: applyPhase ? 'Applying changes' : restartingPhase ? 'Restarting preview' : 'Queuing restart',
                    uiMessage: phaseMessage,
                    updatedAt: Date.now(),
                  }
                  : normalizeStatusDataForUi(code, {
                    ...statusData,
                    status: status || 'starting',
                    uiStage: uiStage || step || phase || 'starting',
                    uiTitle: applyPhase ? 'Applying changes' : restartingPhase ? 'Restarting preview' : 'Queuing restart',
                    uiMessage: phaseMessage,
                    updatedAt: Date.now(),
                  }),
              );
              statusPollTimeoutRef.current = setTimeout(pollStatus, delayMs);
              return;
            }

            const transitionalAttachStates = new Set(['pending', 'starting', 'booting', 'creating_machine', 'creating_server', 'transitioning']);
            const isTransitionalAttachState = transitionalAttachStates.has(status) || transitionalAttachStates.has(uiStage);

            if (!readyFlag && attachableFlag) {
              const attachUrl = isValidPreviewUrlCandidate(browserDeploymentUrl)
                ? withCacheBust(browserDeploymentUrl)
                : browserDeploymentUrl;

              backendReadyRef.current = true;
              lastReadyUrlRef.current = attachUrl || browserDeploymentUrl || null;
              setError(null);
              setCanRetry(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setIsPolling(false);
              setLoadingStatus('Preview container is attachable. Loading now.');

              if (attachUrl && previewUrlRef.current !== attachUrl) {
                iframeLoadedSuccessfullyRef.current = false;
                setPreviewUrl(attachUrl);
              }

              return;
            }

            if (!readyFlag && !attachableFlag && isTransitionalAttachState && (activeRestartSignal || retryableFlag || restartPendingFlag)) {
              const delayMs = retryAfterSeconds !== null ? Math.max(1_000, retryAfterSeconds * 1000) : POLL_INTERVAL_MS;
              const transitionMessage = activeRestartSignal
                ? (retryAfterSeconds !== null ? `Restarting preview… retrying in ${retryAfterSeconds}s…` : 'Restarting preview…')
                : (retryAfterSeconds !== null ? `Preview is still starting. Retrying in ${retryAfterSeconds}s…` : 'Preview is still starting. Retrying automatically…');
              setError(null);
              setCanRetry(false);
              setIsLoading(true);
              setConnectingToExisting(false);
              setIsPolling(true);
              setLoadingStatus(transitionMessage);
              setCurrentStatusData((current: any) =>
                current && typeof current === 'object'
                  ? {
                      ...current,
                      ...statusData,
                      status: status || current.status || 'starting',
                      uiStage: uiStage || current.uiStage || 'starting',
                      uiTitle: activeRestartSignal ? 'Restarting preview' : 'Starting preview',
                      uiMessage: transitionMessage,
                      updatedAt: Date.now(),
                    }
                  : normalizeStatusDataForUi(code, {
                      ...statusData,
                      status: status || 'starting',
                      uiStage: uiStage || 'starting',
                    uiTitle: activeRestartSignal ? 'Restarting preview' : 'Starting preview',
                    uiMessage: transitionMessage,
                      updatedAt: Date.now(),
                    }),
              );
              statusPollTimeoutRef.current = setTimeout(pollStatus, delayMs);
              return;
            }

            const compileErrorInfo = getCompileErrorStateFromStatus(code, statusData);
            if (compileErrorInfo) {
              setCompileErrorState(compileErrorInfo);
              setError(null);
              setCanRetry(true);
              setCookieRecoveryPromptVisible(false);
              setIsPolling(true);
              setIsLoading(false);
              setConnectingToExisting(false);

              const fingerprintKey = compileErrorInfo.fingerprint || `${code}:compile_error`;
              compileErrorActiveFingerprintRef.current = fingerprintKey;

              if (!compileErrorSeenByFingerprintRef.current[fingerprintKey]) {
                compileErrorSeenByFingerprintRef.current[fingerprintKey] = true;
                emitCompileErrorTelemetry('compile_error_seen', {
                  code,
                  fingerprint: fingerprintKey,
                  actionType: compileErrorInfo.actionType,
                  fixAction: compileErrorInfo.fixAction || null,
                });
              }

              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
              return;
            }

            // If the backend reports `status=ready` but `ready=false`, we still want to refresh the iframe
            // once (without changing the URL) because the hub may have switched from a waiting page to the app.
            if (status && status !== lastReportedStatusRef.current) {
              if (status === 'ready' && !readyFlag) {
                const base = deploymentUrl || proxyBaseRef.current || previewUrlRef.current;
                if (base) setPreviewUrl(withCacheBust(base));
              }
              lastReportedStatusRef.current = status;
            }

            // If backend/hub provided a URL, always surface it immediately.
            // This ensures the iframe can show its own /__preview loader and we avoid a second outer loader.
            if (deploymentUrl) {
              const deploymentCode = derivePreviewCodeFromUrl(deploymentUrl);
              if (deploymentCode && deploymentCode !== code) {
                console.warn('[WebContainerRunner] Ignoring stale deployment URL from status payload (code mismatch)', {
                  appId,
                  expectedCode: code,
                  deploymentCode,
                  deploymentUrl,
                });
                hubStatusUrlRef.current = null;
                statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
                return;
              }

              latestDeploymentUrlRef.current = browserDeploymentUrl;
              if (!isValidPreviewUrlCandidate(browserDeploymentUrl)) {
                console.warn('[WebContainerRunner] Ignoring invalid preview url from status (missing /preview/<code>?)', {
                  appId,
                  code,
                  deploymentUrl: browserDeploymentUrl,
                });
              } else if ((readyFlag || attachableFlag) && previewUrlRef.current !== browserDeploymentUrl) {
                iframeLoadedSuccessfullyRef.current = false;
                setPreviewUrl(withCacheBust(browserDeploymentUrl));
              }

              // Once we have the viewer token, switch polling to the hub status endpoint.
              const nextHub = buildHubStatusUrl(code, deploymentUrl);
              if (nextHub) {
                // Keep all browser polling on the same-origin backend route boundary.
                hubStatusUrlRef.current = null;
              }
            }

            // Backend contract: treat `ready === true` as the completion signal.
            // Also handle explicit terminal states and transient restarting states.
            if (status === 'stopped') {
              backendReadyRef.current = false;
              await clearStoredContainerCodeEverywhere(appId, user);
              stopAllTimers();
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setLoadingStatus('');
              setError('Something went wrong while starting the preview. Please rebuild or refresh it.');
              setCanRetry(true);
              setPreviewUrl(null);
              return;
            }

            if (status === 'failed' || status === 'canceled' || status === 'cancelled' || status === 'timeout') {
              backendReadyRef.current = false;
              await clearStoredContainerCodeEverywhere(appId, user);
              stopAllTimers();
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setLoadingStatus('');
              setPreviewUrl(null);
              setError('Something went wrong while starting the preview. Please rebuild or refresh it.');
              setCanRetry(true);
              return;
            }

            // New contract can emit uiStage=restarting while the machine restarts.
            // Keep polling, and optionally show the preview URL (fallback UI) if it's already reachable.
            if (uiStage === 'restarting') {
              backendReadyRef.current = false;
              setError(null);
              setCanRetry(false);
              setIsPolling(true);
              setIsLoading(false);
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
              return;
            }

            // Completion contract: only stop polling when `ready === true`.
            if (readyFlag) {
              const recoveredFingerprint = compileErrorActiveFingerprintRef.current;
              if (recoveredFingerprint) {
                emitCompileErrorTelemetry('compile_error_recovered', {
                  code,
                  fingerprint: recoveredFingerprint,
                });
              }
              compileErrorActiveFingerprintRef.current = null;
              setCompileErrorState(null);
              backendReadyRef.current = true;
              const readyUrl = deploymentUrl || latestDeploymentUrlRef.current;
              console.log('Deployment ready at:', readyUrl);

              const browserReadyUrl = buildBrowserPreviewUrl(readyUrl);

              lastReadyUrlRef.current = browserReadyUrl || null;

              if (!readyUrl) {
                console.error('Backend reported ready but no URL provided:', statusData);
                throw new Error('Backend reported app ready but did not provide deployment URL');
              }

              if (!isValidPreviewUrlCandidate(browserReadyUrl)) {
                console.warn('[WebContainerRunner] Backend ready URL is not a valid preview URL; refusing to navigate', {
                  appId,
                  code,
                  readyUrl: browserReadyUrl,
                });
              }
              if (previewUrlRef.current !== browserReadyUrl) {
                setPreviewUrl(browserReadyUrl);
              }

              // If the parent wants to run its own "Refresh" behavior, notify it once.
              // This is intentionally the AppBuilderEditor "Refresh" (reconnect) semantics.
              if (readyUrl && typeof onBackendReady === 'function') {
                const key = `${code}|${browserReadyUrl}`;
                if (lastBackendReadyNotifyRef.current !== key) {
                  lastBackendReadyNotifyRef.current = key;
                  try {
                    onBackendReady({ appId, code, url: browserReadyUrl });
                  } catch {
                    // ignore
                  }
                }

                // Some browsers (notably Safari) can lag rendering after backend ready.
                // Keep polling/status visible until iframe navigation confirms load.
                if (!iframeLoadedSuccessfullyRef.current) {
                  setIsPolling(true);
                  setIsLoading(false);
                  statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
                  return;
                }

                setCurrentStatusData(null);
                setLoadingStatus('');
                setIsPolling(false);
                setIsLoading(false);
                return;
              }

              // Default behavior (no parent callback): reload the iframe by cache-busting the URL
              // (preserving the viewer token `t`).
              if (isValidPreviewUrlCandidate(readyUrl)) {
                // Prevent a reload loop: if we're already on this base URL, do not keep appending new cache-busters.
                if (proxyBaseRef.current !== readyUrl || !previewUrlRef.current) {
                  proxyBaseRef.current = toPreviewRootUrl(readyUrl);
                  setPreviewUrl(withCacheBust(proxyBaseRef.current));
                }
              }
              if (!iframeLoadedSuccessfullyRef.current) {
                setIsPolling(true);
                setIsLoading(false);
                statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
                return;
              }

              setCurrentStatusData(null);
              setLoadingStatus('');
              setIsPolling(false);
              appLoadedSuccessfullyRef.current = true;
              pollingRetryCountRef.current = 0;
              if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
              }

              return;
            }
            if (status === 'error') {
              // Handle specific timeout errors more gracefully
              const errorMessage =
                statusData.error ||
                statusData.uiMessage ||
                statusData.uiTitle ||
                'Preview failed to start';
              const isTimeoutError = errorMessage.includes('Preview URL did not become reachable before timeout');

              if (isTimeoutError && deploymentUrl) {
                // Backend timed out but provided a URL - try connecting directly
                console.log('Backend timed out but provided URL, attempting direct connection:', deploymentUrl);

                try {
                  const probe = await probePreviewUrl(appId, deploymentUrl);
                  if (probe.reachable) {
                    console.log('Direct probe successful, proceeding with URL:', deploymentUrl);
                    iframeLoadedSuccessfullyRef.current = false;
                    setPreviewUrl(buildBrowserPreviewUrl(deploymentUrl));
                    setLoadingStatus('Preview is reachable. Still verifying readiness…');
                    setIsPolling(true);
                    setError(null);
                    setCanRetry(false);
                    appLoadedSuccessfullyRef.current = true;
                    pollingRetryCountRef.current = 0;
                    statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
                    return;
                  }
                  if (probe.status === 404 || probe.status === 410) {
                    console.log(`Direct probe returned ${probe.status}; clearing stale container code for ${code}.`);
                    await clearStoredContainerCodeEverywhere(appId, user);
                  }
                  console.log('Direct probe indicates URL is not reachable yet:', deploymentUrl);
                } catch (directError) {
                  console.log('Direct connection also failed:', directError);
                  // Fall through to normal error handling
                }
              }

              // General "handoff" safety:
              // Sometimes the backend marks status=error due to healthcheck issues/restarts, but the preview URL may still be reachable.
              // If we have a URL, try a last-chance probe before we permanently fail.
              if (!isTimeoutError && deploymentUrl) {
                try {
                  const probe = await probePreviewUrl(appId, deploymentUrl);
                  if (probe.reachable) {
                    console.log('Preview URL is reachable despite error status; proceeding with URL:', deploymentUrl);
                    iframeLoadedSuccessfullyRef.current = false;
                    setPreviewUrl(buildBrowserPreviewUrl(deploymentUrl));
                    setLoadingStatus('Preview is reachable. Still verifying readiness…');
                    setIsPolling(true);
                    setError(null);
                    setCanRetry(false);
                    appLoadedSuccessfullyRef.current = true;
                    pollingRetryCountRef.current = 0;
                    statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
                    return;
                  }

                  // If the URL is definitively gone, clear the saved code so the next action starts fresh.
                  if (probe.status === 404 || probe.status === 410) {
                    console.log(`Probe returned ${probe.status} during error handoff; clearing stale container code for ${code}.`);
                    await clearStoredContainerCodeEverywhere(appId, user);
                  }
                } catch (probeErr) {
                  console.log('Preview URL probe failed during error handoff:', probeErr);
                }
              }

              // Frontend resilience: if this error is very fresh, treat it as transient and keep polling.
              // We use `createdAt` when present, otherwise fall back to `updatedAt`.
              const createdAtMs = getUpdatedAtMs(statusData?.createdAt) ?? getUpdatedAtMs(statusData?.updatedAt);
              const previewAgeMs = typeof createdAtMs === 'number' ? (Date.now() - createdAtMs) : null;
              const withinGrace = typeof previewAgeMs === 'number' && previewAgeMs >= 0 && previewAgeMs < PREVIEW_ERROR_GRACE_MS;
              if (withinGrace) {
                const remainingMs = Math.max(0, PREVIEW_ERROR_GRACE_MS - previewAgeMs);

                // Keep showing progress UI, but do not hard-fail the session.
                setError(null);
                setCanRetry(false);
                setIsPolling(true);
                setIsLoading(true);
                setConnectingToExisting(false);

                setCurrentStatusData(
                  normalizeStatusDataForUi(code, {
                    ...statusData,
                    status: 'booting',
                    uiStage: 'booting',
                    uiTitle: 'Starting preview',
                    uiMessage: `Preview hit a transient boot error and is restarting. Still trying for ~${Math.ceil(remainingMs / 1000)}s…`,
                    uiProgress: typeof statusData?.uiProgress === 'number' ? statusData.uiProgress : 0,
                  })
                );

                setLoadingStatus('Preview is still starting (this can take a few minutes)…');

                // Continue polling a bit faster during grace.
                statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
                return;
              }

              if (backendSignal.recoverable && !backendSignal.hardFailure) {
                const elapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined;
                const retryDelayMs = Math.max(POLL_INTERVAL_MS, getPollBackoffMs(pollFetchFailureCountRef.current));

                setError(null);
                setCanRetry(false);
                setIsPolling(true);
                setIsLoading(false);
                setConnectingToExisting(false);
                setLoadingStatus('Preview is temporarily unreachable. Retrying automatically…');
                setCurrentStatusData(
                  normalizeStatusDataForUi(code, {
                    ...statusData,
                    status: 'starting',
                    uiStage: backendSignal.uiStage || 'proxy_unreachable_auto',
                    uiTitle: 'Preview restarting',
                    uiMessage: 'The preview is temporarily unreachable. Keeping the session alive and retrying automatically…',
                    uiProgress: typeof statusData?.uiProgress === 'number' ? statusData.uiProgress : 0,
                    updatedAt: Date.now(),
                  })
                );

                statusPollTimeoutRef.current = setTimeout(pollStatus, retryDelayMs);
                return;
              }

              // Normal error handling
              const flyApi = Array.isArray(statusData?.events)
                ? statusData.events
                  .map((e: any) => e?.extra?.flyApi)
                  .find((x: any) => x && typeof x === 'object')
                : null;

              const flyBody = typeof flyApi?.responseBody === 'string' ? flyApi.responseBody : '';
              const flyIsDischargeMissing =
                Number(flyApi?.status) === 401 &&
                /missing third-party discharge token/i.test(flyBody);

              console.error('Backend reported error status:', { errorMessage, statusData, flyApi });

              await clearStoredContainerCodeEverywhere(appId, user);
              stopAllTimers();

              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setLoadingStatus('');
              setError('Something went wrong while starting the preview. Please rebuild or refresh it.');
              setCanRetry(true);
              setPreviewUrl(null);
              return;

            } else if (status === 'ready' && !readyFlag) {
              // Some backend flows emit status='ready' before flipping the authoritative ready=true flag.
              // This is expected; keep polling, and avoid showing an 'unknown status' warning.
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
              return;

            } else if (status === 'pending' || status === 'archiving' ||
              status === 'uploading_archive' || status === 'creating_machine' ||
              status === 'creating_server' || status === 'booting' || status === 'building' ||
              status === 'compiling' || status === 'starting' ||
              status === 'transitioning' || restartPendingFlag || retryableFlag) {
              // Still building or waiting to attach, continue polling and show progress if available.
              // If retryAfterSeconds is present, honor the backend delay instead of hammering the status endpoint.

              if (statusData.uiTitle && statusData.uiMessage && retryAfterSeconds === null) {
                // Use the rich progress information from backend.
              } else if (retryAfterSeconds !== null) {
                setLoadingStatus(`Preview is still starting. Retrying in ${retryAfterSeconds}s…`);
              } else {
                setLoadingStatus('Building app... (this may take several minutes)');
              }
              statusPollTimeoutRef.current = setTimeout(pollStatus, retryAfterSeconds !== null ? Math.max(1_000, retryAfterSeconds * 1000) : POLL_INTERVAL_MS);

            } else {
              // Unknown status - log it and treat as still building for now
              console.warn('Unknown status received from backend:', statusData.status, statusData);
              setLoadingStatus(`Building app... (status: ${status})`);
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
            }

          } catch (err) {
            console.error('Status polling error:', err);

            // Handle specific backend errors that shouldn't be shown to users
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            const failureSignature = String(errorMessage || 'unknown_poll_error').slice(0, 240);
            if (lastPollFailureSignatureRef.current === failureSignature) {
              repeatedPollFailureCountRef.current += 1;
            } else {
              lastPollFailureSignatureRef.current = failureSignature;
              repeatedPollFailureCountRef.current = 1;
            }

            if (repeatedPollFailureCountRef.current >= 5) {
              stopAllTimers();
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setCurrentStatusData(null);
              setLoadingStatus('');
              setError('Preview polling stopped after repeated identical failures. Try Refresh.');
              setCanRetry(true);
              return;
            }

            const online = typeof navigator !== 'undefined' ? navigator.onLine : null;
            const looksLikeNetworkFetchFailure =
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('NetworkError') ||
              (err instanceof TypeError && /fetch/i.test(String(errorMessage)));

            if (looksLikeNetworkFetchFailure) {
              pollFetchFailureCountRef.current += 1;
              const elapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined;

              if (pollFetchFailureCountRef.current >= 3 && online !== false) {
                setPollNetworkWarning(
                  'Connection checks are being blocked or interrupted. This is often caused by privacy/adblock extensions, strict corporate proxies, or VPN routing. You can keep waiting, or temporarily disable blockers for this site.'
                );

                if (typeof elapsedMs === 'number' && elapsedMs >= PREVIEW_IFRAME_WARN_MS) {
                  reportPollIssueOnce(`poll-fetch-failed-warn:${appId}:${code}`, {
                    appId,
                    code,
                    action: 'preview_poll_fetch_warn',
                    severity: 'warning',
                    statusCode: 200,
                    status: 'poll_fetch_failed_network_interference_suspected',
                    reason: 'network_interference_suspected',
                    message: 'Repeated status polling fetch failures while browser was online; privacy extension/adblock/VPN interference suspected.',
                    elapsedMs,
                    previewUrl: previewUrlRef.current,
                    backendStatusData: lastBackendStatusRef.current,
                  });
                }

                if (typeof elapsedMs === 'number' && elapsedMs >= PREVIEW_IFRAME_CRITICAL_MS && !backendReadyRef.current) {
                  const backendSignal = classifyBackendSignal(lastBackendStatusRef.current);
                  reportPollIssueOnce(`poll-fetch-failed-critical:${appId}:${code}:${backendSignal.timeoutReason || 'not_ready'}`, {
                    appId,
                    code,
                    action: 'preview_poll_fetch_critical',
                    severity: 'critical',
                    statusCode: 504,
                    status: 'poll_fetch_failed_critical_timeout',
                    reason: backendSignal.timeoutReason || 'poll_fetch_failed_critical_timeout',
                    message: 'Status polling fetch failures persisted past the critical timeout while preview was still not ready.',
                    elapsedMs,
                    previewUrl: previewUrlRef.current,
                    requestId: backendSignal.requestId,
                    jobId: backendSignal.jobId,
                    backendStatusData: lastBackendStatusRef.current,
                  });
                }
              }
            }

            if (errorMessage.includes('Element at index 0 is not a valid array element') ||
              errorMessage.includes('FieldValue.serverTimestamp() cannot be used inside of an array')) {
              console.error('Backend Firestore error detected - this is a server-side issue that should be fixed');
              // Don't count this as a polling retry, just try again
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
              return;
            } else if (errorMessage.includes('files is not iterable')) {
              console.error('Backend validation error - this appears to be a server-side bug');
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setError('Server configuration error. Please try again later or contact support.');
              setCanRetry(true);
              setLoadingStatus('');
              setCurrentStatusData(null);
              setPreviewUrl(null);
              return; // Don't retry this specific error
            }

            // Increment polling retry count
            pollingRetryCountRef.current += 1;

            if (pollingRetryCountRef.current >= maxPollingRetries) {
              // Max polling retries reached, show neutral message instead of error
              const suspectedInterference = pollFetchFailureCountRef.current >= 3 && online !== false;
              const timeoutReportKey = `retry-timeout:${appId}:${code}`;
              const timeoutContext = extractTimeoutBackendContext(currentStatusData || lastBackendStatusRef.current || null);
              if (lastTimeoutReportKeyRef.current !== timeoutReportKey) {
                lastTimeoutReportKeyRef.current = timeoutReportKey;
                void reportPreviewTimeout({
                  appId,
                  code,
                  status: 'poll_retries_exhausted',
                  reason: suspectedInterference
                    ? 'poll_retries_exhausted_network_interference_suspected'
                    : 'poll_retries_exhausted',
                  message: suspectedInterference
                    ? `Preview polling retries exhausted after repeated fetch failures while connecting to machine ${timeoutContext.machineId || 'unknown'}; privacy extension/adblock/VPN interference is suspected.`
                    : `Preview status polling retries were exhausted before readiness${timeoutContext.machineId ? ` while connecting to machine ${timeoutContext.machineId}` : ''}.`,
                  ageMs: pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined,
                  previewUrl: previewUrlRef.current,
                  browser: detectBrowserLabel(),
                  userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : 'unknown',
                  requestId: timeoutContext.requestId || undefined,
                  jobId: timeoutContext.jobId || undefined,
                  backend: timeoutContext.backend,
                });
              }
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setCurrentStatusData(null); // Clear status data
              setLoadingStatus(''); // Clear loading status on timeout
              setError(`Build is taking longer than expected${timeoutContext.machineId ? ` while connecting to machine ${timeoutContext.machineId}` : ''}. The app may still be starting up. Try Refresh first, if it still fails, please contact support.`);
              setCanRetry(true);
              setPreviewUrl(null);
              stopAllTimers();
              return; // Don't throw, just return to avoid getting stuck
            } else {
              // Retry polling
              console.log(`Polling retry ${pollingRetryCountRef.current}/${maxPollingRetries}`);
              setLoadingStatus(`Retrying status check... (${pollingRetryCountRef.current}/${maxPollingRetries})`);
              const nextDelay = Math.max(POLL_INTERVAL_MS, getPollBackoffMs(pollFetchFailureCountRef.current));
              statusPollTimeoutRef.current = setTimeout(pollStatus, nextDelay);
            }
          }
        };

        pollStartedAtRef.current = Date.now();
        // Start polling quickly; the iframe URL will appear as soon as the backend issues it.
        statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);

      } catch (err) {
        console.error('Error starting app:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setCompileErrorState(null);
        setCurrentStatusData(null);
        lastBackendStatusRef.current = null;
        setIsPolling(false); // Reset polling state on error
        pollingRetryCountRef.current = 0; // Reset polling retry count

        // Classify error types for better retry logic
        const isNetworkError = errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('NetworkError') ||
          errorMessage.includes('ERR_') ||
          errorMessage.includes('net::');

        const isServerError = errorMessage.includes('Failed to start app') ||
          errorMessage.includes('500') ||
          errorMessage.includes('Internal Server Error') ||
          errorMessage.includes('We couldn\'t start the preview') ||
          errorMessage.includes('Please try again');

        const isTimeout = errorMessage.includes('timeout') ||
          errorMessage.includes('did not become ready');

        const isProxyError = errorMessage.includes('Proxy endpoint') ||
          errorMessage.includes('proxy connection');

        const isDiskSpaceError = errorMessage.includes('Insufficient disk space');

        const isPreconditionError = errorMessage.includes('412') ||
          errorMessage.includes('Precondition Failed');

        const isBuildError = errorMessage.includes('Build failed') ||
          errorMessage.includes('npm install failed') ||
          errorMessage.includes('yarn install failed') ||
          errorMessage.includes('pnpm install failed') ||
          errorMessage.includes('Installation failed') ||
          errorMessage.includes('Failed to install dependencies') ||
          errorMessage.includes('Could not resolve dependencies');

        const isPayloadTooLarge =
          errorMessage.includes('HTTP 413') ||
          errorMessage.toLowerCase().includes('payload too large') ||
          errorMessage.toLowerCase().includes('request entity too large');

        const isRetryable = (isNetworkError || isServerError || isTimeout || isProxyError || isBuildError) && !isDiskSpaceError && !isPreconditionError && !isPayloadTooLarge;

        console.log(`Error classification: Network=${isNetworkError}, Server=${isServerError}, Timeout=${isTimeout}, Proxy=${isProxyError}, Build=${isBuildError}, PayloadTooLarge=${isPayloadTooLarge}, DiskSpace=${isDiskSpaceError}, Precondition=${isPreconditionError}, Retryable=${isRetryable}`);

        // Circuit breaker: prevent infinite retries
        totalAttemptsRef.current += 1;
        const maxTotalAttempts = 10; // Absolute maximum attempts across all retries

        // Retry logic for transient failures
        if (startAttempt < maxRetries && isRetryable && !retryScheduledRef.current && totalAttemptsRef.current <= maxTotalAttempts) {
          // Allow more retries for build errors (up to 3 instead of 2)
          const effectiveMaxRetries = isBuildError ? 3 : maxRetries;

          if (startAttempt >= effectiveMaxRetries) {
            console.log(`Max retries reached for ${isBuildError ? 'build' : 'other'} error, not retrying`);
          } else {
            // More graceful retry with longer delays: 5s, 15s (instead of 3s, 8s) to be less aggressive
            // Even longer delays for build errors: 10s, 30s
            const retryDelay = isBuildError
              ? (startAttempt === 0 ? 10000 : 30000)  // 10s, 30s for build errors
              : (startAttempt === 0 ? 5000 : 15000);   // 5s, 15s for other errors

            console.log(`Retrying in ${retryDelay}ms... (attempt ${startAttempt + 1}/${effectiveMaxRetries})`);
            console.log(`Error type: ${isNetworkError ? 'Network' : isServerError ? 'Server' : isTimeout ? 'Timeout' : isProxyError ? 'Proxy' : isBuildError ? 'Build' : 'Unknown'}`);

            setStartAttempt(prev => prev + 1);
            setCanRetry(false); // Disable retry button during automatic retry
            retryScheduledRef.current = true;

            // Clear any existing retry timeout
            if (retryTimeoutRef.current) {
              clearTimeout(retryTimeoutRef.current);
            }

            retryTimeoutRef.current = setTimeout(() => {
              retryScheduledRef.current = false;
              retryTimeoutRef.current = null;
              // Reset some state for retry
              setError(null);
              setIsPolling(false); // Reset polling state
              const retry = async () => {
                await startApp();
              };
              retry();
            }, retryDelay);
          }
        } else if (startAttempt >= maxRetries || totalAttemptsRef.current > maxTotalAttempts) {
          let finalErrorMessage = `Failed after ${totalAttemptsRef.current} total attempts: ${errorMessage}`;

          if (totalAttemptsRef.current > maxTotalAttempts) {
            finalErrorMessage += ' Error E001: Too many attempts.';
          } else if (isProxyError) {
            finalErrorMessage += ' Error E002: Proxy failed.';
          } else if (isServerError) {
            finalErrorMessage += ' Error E003: Server issue.';
          } else if (isDiskSpaceError) {
            finalErrorMessage += ' Error E004: Disk space low.';
          } else if (isPreconditionError) {
            finalErrorMessage += ' Error E005: Machine state conflict.';
          } else if (isBuildError) {
            finalErrorMessage += ' Error E006: Build/installation failed.';
          } else if (isPayloadTooLarge) {
            finalErrorMessage += ' Error E007: Payload too large (413).';
          }

          setError(finalErrorMessage);
          setCanRetry(true);
          setLoadingStatus(''); // Clear loading status on final failure
        } else {
          // Non-retryable error
          console.log('Error is not retryable:', errorMessage);
          let finalErrorMessage = errorMessage;

          if (isDiskSpaceError) {
            finalErrorMessage += ' Error E004: Disk space low.';
          } else if (isPreconditionError) {
            finalErrorMessage += ' Error E005: Machine state conflict.';
          } else if (isBuildError) {
            finalErrorMessage += ' Error E006: Build/installation failed.';
          } else if (isPayloadTooLarge) {
            finalErrorMessage += ' Error E007: Payload too large (413).';
          }

          setError(finalErrorMessage);
          setCanRetry(false);
          setLoadingStatus(''); // Clear loading status on non-retryable error
        }
      } finally {
        setIsLoading(false);
      }
    };

    // Defer the start slightly so React 18 StrictMode's mount->unmount->mount
    // cycle in development doesn't trigger two overlapping starts.
    const startTimer = window.setTimeout(() => {
      if (startRunIdRef.current !== runId) return;
      startApp();
    }, 0);

    return () => {
      clearTimeout(startTimer);

      // Clear any pending retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      // Clear any pending status polling
      if (statusPollTimeoutRef.current) {
        clearTimeout(statusPollTimeoutRef.current);
        statusPollTimeoutRef.current = null;
      }

      // Clear any pending iframe load timeout
      if (!previewUrl) {
        // No preview visible (either not started yet, or errored/reset).
        try { onPreviewReadyChange?.(false); } catch { }
        return;
      }

      if (iframeLoadTimeoutRef.current) {
        clearTimeout(iframeLoadTimeoutRef.current);
        iframeLoadTimeoutRef.current = null;
      }
      // Abort any in-flight start/poll loop.
      startRunIdRef.current = runId + 1;
      startRunIdRef.current = runId + 1;

      // Only cleanup if there's no active preview URL (app not successfully loaded)
      // This prevents killing apps that are actively being viewed
      if (previewUrlRef.current && appLoadedSuccessfullyRef.current) {
        console.log(`[WebContainerRunner] Skipping cleanup for active app ${appId} with preview URL`);
        return;
      }

      // Cleanup on unmount - but be very conservative
      const elapsedMs = Math.max(0, Date.now() - (effectStartedAtRef.current || 0));
      const delayMs = elapsedMs < 60000 ? 120000 : 30000; // 2min delay for recent starts, 30s otherwise

      const cleanup = () => {
        console.log(`[WebContainerRunner] Cleaning up app ${appId} after ${elapsedMs}ms elapsed, delay was ${delayMs}ms`);
        pendingCleanupTimers.delete(appId);
        ensureSessionAndCsrf()
          .catch(() => null)
          .then((csrf) => {
            if (!csrf) {
              console.log('No CSRF token available for cleanup');
              return;
            }
            // Use the new async API cleanup endpoint if we have a polling code
            const cleanupUrl = pollingCodeRef.current
              ? `/api/webcontainer-delete?code=${pollingCodeRef.current}&appId=${appId}`
              : `/api/webcontainer?appId=${encodeURIComponent(appId)}`;
            const cleanupBody = pollingCodeRef.current
              ? undefined
              : JSON.stringify({ appId });

            return fetch(cleanupUrl, {
              method: 'DELETE',
              keepalive: true,
              headers: {
                'Content-Type': 'application/json',
                'x-csrf': csrf,
              },
              body: cleanupBody,
            }).catch(console.error);
          });
      };

      const timer = window.setTimeout(cleanup, delayMs);
      pendingCleanupTimers.set(appId, timer);
    };
  }, [appId, filesReady, startAttempt, manualStartNonce, restartToken, reconnectToken, forceFreshStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload the iframe without tearing down the underlying server/process.
  useEffect(() => {
    if (typeof reloadToken !== 'number') return;
    if (lastReloadTokenRef.current === reloadToken) return;
    lastReloadTokenRef.current = reloadToken;
    if (!proxyBaseRef.current) return;

    // Coalesce rapid reload requests to avoid request thrash + flicker.
    const now = Date.now();
    if (now - lastReloadIssuedAtRef.current < 800) return;
    lastReloadIssuedAtRef.current = now;

    // If we are currently masking the iframe behind a loading state (e.g. "UI updating"),
    // we still want to reload as soon as the parent asks.
    const nextUrl = withCacheBust(proxyBaseRef.current);
    setPreviewUrl(nextUrl);
  }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // After /apply finishes, HMR should update the preview. In embedded iframes it can be
  // blocked or silently stall. When the parent signals an apply completed, schedule a
  // delayed hard reload *only when* HMR websocket isn't OK.
  useEffect(() => {
    if (typeof applyToken !== 'number') return;
    if (applyToken <= 0) return;
    if (lastApplyTokenRef.current === applyToken) return;
    lastApplyTokenRef.current = applyToken;

    setIsApplyRefreshing(true);

    if (applyReloadTimeoutRef.current) {
      clearTimeout(applyReloadTimeoutRef.current);
      applyReloadTimeoutRef.current = null;
    }

    // If HMR is healthy, do nothing.
    if (hmrWsStatus === 'ok') {
      const doneTimer = setTimeout(() => {
        setIsApplyRefreshing(false);
      }, 1800);
      return () => {
        clearTimeout(doneTimer);
      };
    }

    // Wait for Next to finish recompiling, otherwise we reload old output.
    const delayMs = 15_000;
    applyReloadTimeoutRef.current = setTimeout(() => {
      applyReloadTimeoutRef.current = null;
      setIsApplyRefreshing(false);
      if (!iframeLoadedSuccessfullyRef.current) return;
      if (!previewUrlRef.current) return;
      hardReloadPreview('apply_finished');
    }, delayMs);

    return () => {
      if (applyReloadTimeoutRef.current) {
        clearTimeout(applyReloadTimeoutRef.current);
        applyReloadTimeoutRef.current = null;
      }
    };
  }, [applyToken, hmrWsStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle iframe load timeout
  useEffect(() => {
    if (externalPreviewMode) {
      if (iframeLoadTimeoutRef.current) {
        clearTimeout(iframeLoadTimeoutRef.current);
        iframeLoadTimeoutRef.current = null;
      }
      if (iframeCriticalTimeoutRef.current) {
        clearTimeout(iframeCriticalTimeoutRef.current);
        iframeCriticalTimeoutRef.current = null;
      }
      return;
    }

    if (!previewUrl) {
      // Clear any existing timeout
      if (iframeLoadTimeoutRef.current) {
        clearTimeout(iframeLoadTimeoutRef.current);
        iframeLoadTimeoutRef.current = null;
      }
      if (iframeCriticalTimeoutRef.current) {
        clearTimeout(iframeCriticalTimeoutRef.current);
        iframeCriticalTimeoutRef.current = null;
      }
      return;
    }

    // Avoid loader flicker on "soft" reloads where only the cache-buster changes.
    const isSoftReload = (() => {
      const prev = lastPreviewUrlForLoadRef.current;
      if (!prev) return false;
      try {
        const prevUrl = new URL(prev);
        const nextUrl = new URL(previewUrl);
        prevUrl.searchParams.delete('cb');
        nextUrl.searchParams.delete('cb');
        return prevUrl.toString() === nextUrl.toString();
      } catch {
        return false;
      }
    })();

    lastPreviewUrlForLoadRef.current = previewUrl;

    if (!isSoftReload) {
      // Reset iframe loaded state on meaningful URL changes.
      iframeLoadedSuccessfullyRef.current = false;
      try { onPreviewReadyChange?.(false); } catch { }
    }

    // Two-stage timeout policy: warn at 30s (configurable), critical at 120s (configurable).
    if (!isSoftReload) {
      iframeLoadTimeoutRef.current = setTimeout(() => {
        if (!iframeLoadedSuccessfullyRef.current) {
          console.log('Iframe load timeout - URL may be unreachable:', previewUrl);
          // If backend hasn't declared ready yet, treat iframe reachability as transient.
          // Keep polling so we can recover from restarts/DNS delays.
          if (!backendReadyRef.current) {
            const elapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : 0;
            void reportPreviewAlert({
              appId,
              code: pollingCodeRef.current || undefined,
              action: 'preview_slow_start_warn',
              severity: 'warning',
              statusCode: 200,
              status: 'iframe_load_timeout_waiting_for_ready',
              reason: 'preview_slow_start_waiting_for_ready',
              message: 'Preview is still starting; iframe was not interactive at warn threshold while backend remained in a recoverable state.',
              elapsedMs,
              previewUrl,
              backendStatusData: lastBackendStatusRef.current,
            }).then((result) => {
              if (result.sent) {
                iframeWarnContextRef.current = {
                  key: result.alertKey,
                  code: pollingCodeRef.current || 'unknown',
                  previewUrl: String(previewUrl || ''),
                  warnedAt: Date.now(),
                };
              }
            }).catch(() => undefined);

            const remainingToCritical = Math.max(1_000, PREVIEW_IFRAME_CRITICAL_MS - PREVIEW_IFRAME_WARN_MS);
            if (iframeCriticalTimeoutRef.current) {
              clearTimeout(iframeCriticalTimeoutRef.current);
              iframeCriticalTimeoutRef.current = null;
            }
            iframeCriticalTimeoutRef.current = setTimeout(() => {
              if (iframeLoadedSuccessfullyRef.current || backendReadyRef.current) return;
              const latestStatus = lastBackendStatusRef.current;
              const signal = classifyBackendSignal(latestStatus);
              const criticalElapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : PREVIEW_IFRAME_CRITICAL_MS;

              if (!signal.hardFailure && signal.recoverable && criticalElapsedMs < PREVIEW_IFRAME_CRITICAL_MS) {
                return;
              }

              void reportPreviewAlert({
                appId,
                code: pollingCodeRef.current || undefined,
                action: 'preview_slow_start_critical',
                severity: 'critical',
                statusCode: 504,
                status: 'iframe_load_timeout_waiting_for_ready',
                reason: signal.timeoutReason || 'iframe_load_timeout_waiting_for_ready',
                message: 'Preview iframe remained unavailable beyond critical timeout and backend still was not ready.',
                elapsedMs: criticalElapsedMs,
                previewUrl,
                requestId: signal.requestId,
                jobId: signal.jobId,
                backendStatusData: latestStatus,
              });
            }, remainingToCritical);

            setError(null);
            setCanRetry(false);
            setIsLoading(false);
            setIsPolling(true);
            setConnectingToExisting(false);
            setLoadingStatus('');
            setCurrentStatusData((prev: any) =>
              prev && typeof prev === 'object'
                ? {
                  ...prev,
                  uiStage: prev?.uiStage || 'waiting_for_preview',
                  uiTitle: prev?.uiTitle || 'Starting preview',
                  uiMessage: prev?.uiMessage || 'Preview is still loading. If it stays stuck, click Refresh.',
                  updatedAt: Date.now(),
                }
                : {
                  uiStage: 'waiting_for_preview',
                  uiTitle: 'Starting preview',
                  uiMessage: 'Preview is still loading. If it stays stuck, click Refresh.',
                  updatedAt: Date.now(),
                  status: 'starting',
                  uiProgress: 0,
                }
            );
            iframeLoadedSuccessfullyRef.current = false;
            appLoadedSuccessfullyRef.current = true;
            try { onPreviewReadyChange?.(false); } catch { }
            return;
          }

          // If backend had already declared ready, treat this as a real failure.
          const cookieLikely = isHubPreviewUrl(String(previewUrl || ''));
          if (cookieLikely && isSafariLikeBrowser()) {
            switchToExternalPreviewMode(String(previewUrl || ''), 'safari_iframe_timeout_hub_preview');
            return;
          }
          if (cookieLikely) {
            setError('We couldn\'t open the preview. Please refresh or rebuild to try again.');
            setCookieRecoveryPromptVisible(true);
            setCanRetry(true);
            reportCookieIframeBlocked({
              previewUrl,
              reason: 'iframe_load_timeout_cookie_likely',
              message: 'Preview couldn’t load in iframe due to likely routing-cookie block.',
            });
            scheduleAutomaticPreviewRestart('iframe_load_timeout_cookie_likely', 6000);
          } else {
            reportLoadingIssueOnce(`iframe-load-timeout-ready-unreachable:${appId}:${pollingCodeRef.current || 'unknown'}:${String(previewUrl || '')}`, {
              appId,
              code: pollingCodeRef.current || undefined,
              status: 'iframe_load_timeout_backend_ready_unreachable',
              reason: 'iframe_load_timeout_backend_ready_unreachable',
              message: 'Preview iframe timed out after backend reported ready; preview URL appears unreachable from the embedded frame.',
              ageMs: pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined,
              previewUrl,
              browser: detectBrowserLabel(),
              userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : 'unknown',
            });
            setError(`Unable to load preview at ${previewUrl}. Try Reconnect, or use Start fresh to start a new machine.`);
            setCookieRecoveryPromptVisible(false);
            setCanRetry(true);
          }
          setIsLoading(false);
          setIsPolling(false);
          setConnectingToExisting(false);
          setCurrentStatusData(null);
          setLoadingStatus('');
          iframeLoadedSuccessfullyRef.current = false;
          appLoadedSuccessfullyRef.current = false;
          setPreviewUrl(null); // Hide the iframe
          try { onPreviewReadyChange?.(false); } catch { }
          stopAllTimers();
        }
      }, PREVIEW_IFRAME_WARN_MS);
    }

    return () => {
      if (iframeLoadTimeoutRef.current) {
        clearTimeout(iframeLoadTimeoutRef.current);
        iframeLoadTimeoutRef.current = null;
      }
      if (iframeCriticalTimeoutRef.current) {
        clearTimeout(iframeCriticalTimeoutRef.current);
        iframeCriticalTimeoutRef.current = null;
      }
    };
  }, [previewUrl, onPreviewReadyChange, externalPreviewMode, PREVIEW_IFRAME_WARN_MS, PREVIEW_IFRAME_CRITICAL_MS]);

  const previewPresentation = classifyPreviewPresentationState(currentStatusData || lastBackendStatusRef.current || null, {
    previewUrl: previewUrlRef.current,
    iframeLoaded: iframeLoadedSuccessfullyRef.current,
    hmrWsStatus,
    externalPreviewMode,
  });
  const previewStatus = previewPresentation.status;
  const terminalPreviewStatus = previewPresentation.shouldShowTerminalError;
  const previewInteractiveByStatus = previewPresentation.shouldShowLivePreview;
  const previewUrlAgeMs = previewUrlFirstSeenAtRef.current > 0 ? Date.now() - previewUrlFirstSeenAtRef.current : 0;
  const loadingLower = String(loadingStatus || '').toLowerCase();

  const canRenderEmbeddedFrame =
    backendReadyRef.current ||
    hmrWsStatus === 'ok' ||
    previewInteractiveByStatus;
  const showPreviewSurface = Boolean(previewUrl) && !error && !compileErrorState && !terminalPreviewStatus && (externalPreviewMode || canRenderEmbeddedFrame);
  const activePreviewUrl = withPreviewPath(previewUrl || '', navigatePath || '');
  const showApplyRefreshingOverlay = showPreviewSurface && isApplyRefreshing;
  const terminalPreviewStatusData = terminalPreviewStatus ? (currentStatusData || lastBackendStatusRef.current || null) : null;
  const showTerminalPreviewErrorCard = Boolean(error) || terminalPreviewStatus;
  const buildPreviewFixIssueMessage = useCallback((baseMessage: string, rawStatusData: any) => {
    const backendContext = extractTimeoutBackendContext(rawStatusData || null);
    const failure = normalizePreviewFailureDetails(rawStatusData || null);
    const backend = backendContext.backend || null;
    const debug = (backend?.debug && typeof backend.debug === 'object' ? backend.debug : {}) as Record<string, any>;
    const details: string[] = [];

    if (backendContext.machineId) details.push(`machineId=${backendContext.machineId}`);
    if (backendContext.machineState) details.push(`machineState=${backendContext.machineState}`);
    if (typeof backendContext.restartCount === 'number') details.push(`restartCount=${backendContext.restartCount}`);
    if (backendContext.requestId) details.push(`requestId=${backendContext.requestId}`);
    if (backendContext.jobId) details.push(`jobId=${backendContext.jobId}`);
    if (backend?.status) details.push(`backendStatus=${backend.status}`);
    if (backend?.uiStage) details.push(`uiStage=${backend.uiStage}`);
    if (debug?.timeoutReason) details.push(`timeoutReason=${debug.timeoutReason}`);
    if (debug?.compile?.summary) details.push(`compileSummary=${debug.compile.summary}`);
    if (debug?.storage?.rootfsIoCorruption != null) {
      details.push(`rootfsIoCorruption=${String(debug.storage.rootfsIoCorruption)}`);
    }
    if (failure.suggestedFix) details.push(`suggestedFix=${failure.suggestedFix}`);
    if (failure.correlationId) details.push(`correlationId=${failure.correlationId}`);

    const structuredSections: string[] = [];
    if (failure.suggestedFix) {
      structuredSections.push(`Suggested fix:\n${failure.suggestedFix}`);
    }
    if (failure.diagnostic || failure.previewFailure) {
      structuredSections.push(
        `Structured backend diagnostics:\n${formatPreviewFailureSection({
          requestId: failure.requestId,
          correlationId: failure.correlationId,
          correlationIds: failure.correlationIds,
          backendStatus: failure.backendStatus,
          uiStage: failure.uiStage,
          timeoutReason: failure.timeoutReason,
          machineState: failure.machineState,
          restartCount: failure.restartCount,
          rootfsIoCorruption: failure.rootfsIoCorruption,
          suggestedFix: failure.suggestedFix,
          diagnostic: failure.diagnostic,
          previewFailure: failure.previewFailure,
        })}`,
      );
    }

    return [
      baseMessage,
      details.length ? `Backend context: ${details.join('; ')}` : '',
      ...structuredSections,
    ].filter(Boolean).join('\n\n');
  }, []);

  const previewGenerationContextData = currentStatusData || lastBackendStatusRef.current || null;
  const previewIssueContextData = error
    ? previewGenerationContextData
    : terminalPreviewStatusData;
  const previewFailureContract = normalizePreviewFailureContract(previewIssueContextData);
  const canFixPreviewFailureWithAi = canShowPreviewFixWithAi(previewFailureContract);
  const terminalPreviewErrorMessage = buildPreviewFixIssueMessage(
    error || 'Something went wrong while starting the preview.',
    previewIssueContextData,
  );
  const previewIssueDiagnostics = previewIssueContextData
    ? JSON.stringify(
        {
          appId,
          previewUrl: previewUrlRef.current || null,
          loadingStatus: loadingStatus || null,
          canRetry,
          isPolling,
          isLoading,
          connectingToExisting,
          previewUrlAgeMs,
          previewStatus,
          terminalPreviewStatus,
          previewInteractiveByStatus,
          backendReady: backendReadyRef.current,
          currentStatusData: previewIssueContextData,
        },
        null,
        2,
      )
    : null;
  const previewFailureUi = previewIssueContextData ? normalizePreviewFailureDetails(previewIssueContextData) : null;
  const previewFailureTitle = previewFailureUi?.uiTitle || (previewFailureUi?.stalePreviewCode ? 'Preview replaced or deleted' : 'Something went wrong');
  const previewGenerationUi = previewGenerationContextData ? normalizePreviewGenerationContract(previewGenerationContextData) : null;
  const previewFailureMessage = previewGenerationUi?.userMessage
    || previewGenerationUi?.message
    || previewGenerationUi?.details
    || previewFailureUi?.uiMessage
    || (previewFailureContract
      ? (() => {
          switch (previewFailureContract.errorClass) {
            case 'machine_timeout':
              return 'Preview is taking longer than expected.';
            case 'proxy_unreachable':
              return 'Preview server is unreachable.';
            case 'runtime_crash':
              return 'Preview server crashed.';
            case 'preview_replaced_or_deleted':
              return 'This preview has ended.';
            case 'app_unreachable':
              return 'Preview app is unreachable.';
            case 'unknown':
              return 'Preview could not start.';
            default:
              return 'Check chat for details.';
          }
        })()
      : (previewFailureUi?.stalePreviewCode
        ? 'This preview code is no longer valid. Refresh to reopen the latest preview or reopen the latest preview from the app shell.'
        : 'Check chat for details.'));
  const isFixWithAiCoolingDown = fixWithAiCooldownUntil > Date.now();
  const startFixWithAiCooldown = useCallback(() => {
    const cooldownMs = 5_000;
    const until = Date.now() + cooldownMs;
    setFixWithAiCooldownUntil(until);
    if (fixWithAiCooldownTimerRef.current) {
      clearTimeout(fixWithAiCooldownTimerRef.current);
      fixWithAiCooldownTimerRef.current = null;
    }
    fixWithAiCooldownTimerRef.current = window.setTimeout(() => {
      setFixWithAiCooldownUntil((current) => (current === until ? 0 : current));
      fixWithAiCooldownTimerRef.current = null;
    }, cooldownMs);
  }, []);
  const handlePreviewFailureFixRequest = useCallback(() => {
    if (!previewIssueContextData) return;
    if (!canFixPreviewFailureWithAi) return;

    startFixWithAiCooldown();
    const detail = buildPreviewFixIssueMessage(previewFailureMessage, previewIssueContextData);
    onCompileErrorFixRequest?.({
      appId,
      code: 'preview_issue',
      actionType: 'quick_fix_compile',
      fixAction: 'preview_issue_fix',
      autoSend: true,
      compileError: {
        summary: previewFailureTitle,
        detail,
        fingerprint: `preview_issue:${appId}:${String(previewFailureUi?.requestId || previewFailureUi?.correlationId || previewFailureTitle).slice(0, 120)}`,
      },
    });
  }, [appId, buildPreviewFixIssueMessage, canFixPreviewFailureWithAi, onCompileErrorFixRequest, previewFailureMessage, previewFailureTitle, previewFailureUi?.correlationId, previewFailureUi?.requestId, previewIssueContextData, startFixWithAiCooldown]);

  useEffect(() => {
    const previewGenerationStatus = previewGenerationUi?.status || null;
    const isProcessingPreview = previewGenerationStatus === 'processing';
    const isReadyPreview = previewGenerationStatus === 'ready';
    const issueText = previewGenerationUi?.userMessage || previewGenerationUi?.message || previewGenerationUi?.details || terminalPreviewErrorMessage;
    const shouldSurfacePreviewIssue = (showTerminalPreviewErrorCard || previewGenerationUi?.status === 'warning' || previewGenerationUi?.status === 'error') && !isProcessingPreview && !isReadyPreview;
    const nextPayload = shouldSurfacePreviewIssue
      ? {
          status: previewGenerationStatus || 'error',
          issue: issueText,
          userMessage: previewGenerationUi?.userMessage || null,
          message: previewGenerationUi?.message || null,
          details: previewGenerationUi?.details || null,
          warningCode: previewGenerationUi?.warningCode || null,
          errorCode: previewGenerationUi?.errorCode || null,
          retryable: previewGenerationUi?.retryable === true,
          retryAction: previewGenerationUi?.retryAction || null,
          recommendedAction: previewGenerationUi?.recommendedAction || null,
          diagnostics: previewIssueDiagnostics,
          failure: previewFailureContract,
          recommendedActionLabel: mapPreviewRecommendedActionLabel(previewGenerationUi?.recommendedAction),
        }
      : null;

    const nextSignature = nextPayload
      ? [
          'active',
          nextPayload.status,
          nextPayload.issue,
          String(previewFailureUi?.requestId || ''),
          String(previewFailureUi?.correlationId || ''),
          String(previewFailureUi?.backendStatus || ''),
          String(previewFailureUi?.machineState || ''),
          String(previewFailureUi?.uiStage || ''),
          String(previewGenerationUi?.warningCode || ''),
          String(previewGenerationUi?.errorCode || ''),
          String(previewGenerationUi?.retryable || ''),
          String(previewGenerationUi?.retryAction || ''),
          String(previewGenerationUi?.recommendedAction || ''),
        ].join('|')
      : 'inactive';

    if (nextSignature === lastPreviewIssueEmitSignatureRef.current) {
      return;
    }
    lastPreviewIssueEmitSignatureRef.current = nextSignature;

    try {
      onPreviewIssueChange?.(nextPayload);
    } catch {
      // ignore
    }
  }, [onPreviewIssueChange, previewFailureContract, previewFailureUi?.backendStatus, previewFailureUi?.correlationId, previewFailureUi?.machineState, previewFailureUi?.requestId, previewFailureUi?.uiStage, previewGenerationUi?.details, previewGenerationUi?.errorCode, previewGenerationUi?.message, previewGenerationUi?.recommendedAction, previewGenerationUi?.retryAction, previewGenerationUi?.retryable, previewGenerationUi?.status, previewGenerationUi?.userMessage, previewGenerationUi?.warningCode, previewIssueDiagnostics, showTerminalPreviewErrorCard, terminalPreviewErrorMessage]);

  useEffect(() => {
    if (!debugPreviewScenario) return;
    const scenarioKey = `${debugPreviewScenario.mode}:${debugPreviewScenario.nonce}`;
    if (lastDebugPreviewScenarioRef.current === scenarioKey) return;
    lastDebugPreviewScenarioRef.current = scenarioKey;

    const fakeTerminalStatus = {
      status: 'error',
      uiStage: 'machine_failed',
      uiTitle: 'Machine failed to start',
      uiMessage: 'This is a terminal machine error test payload for the dev quick tests panel.',
      error: 'Terminal machine failure test payload',
      machineId: 'dev-terminal-error',
      requestId: `dev-terminal-${debugPreviewScenario.nonce}`,
      jobId: `dev-terminal-job-${debugPreviewScenario.nonce}`,
      generationFormat: 'nextjs',
      archiveZipPath: null,
      warnings: [
        {
          code: 'terminal_error_test',
          message: 'Dev quick test: terminal machine error surfaced to the runner.',
        },
      ],
    };

    setError('Something went wrong while starting the preview.');
    setCanRetry(true);
    setIsPolling(false);
    setIsLoading(false);
    setLoadingStatus('');
    setCurrentStatusData(fakeTerminalStatus);
    setPreviewUrl(null);

    if (debugPreviewScenario.mode === 'terminal-error-auto-fix') {
      onCompileErrorFixRequest?.({
        appId,
        code: 'dev-terminal-error',
        actionType: 'quick_fix_compile',
        fixAction: 'terminal_machine_failure_fix',
        autoSend: true,
        compileError: {
          summary: fakeTerminalStatus.uiTitle,
          detail:
            `${fakeTerminalStatus.uiMessage}\n\n` +
            JSON.stringify(
              {
                status: fakeTerminalStatus.status,
                uiStage: fakeTerminalStatus.uiStage,
                uiTitle: fakeTerminalStatus.uiTitle,
                uiMessage: fakeTerminalStatus.uiMessage,
                error: fakeTerminalStatus.error,
                machineId: fakeTerminalStatus.machineId,
                requestId: fakeTerminalStatus.requestId,
                jobId: fakeTerminalStatus.jobId,
                generationFormat: fakeTerminalStatus.generationFormat,
                archiveZipPath: fakeTerminalStatus.archiveZipPath,
                warnings: fakeTerminalStatus.warnings,
              },
              null,
              2,
            ),
          fingerprint: `terminal_machine_failure:${appId}:${debugPreviewScenario.nonce}`,
        },
      });
    }
  }, [appId, debugPreviewScenario, onCompileErrorFixRequest]);

  return (
    <div className="h-full flex flex-col bg-white text-black/90 border border-black/10 rounded-2xl shadow">
      {compileErrorState && !error ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white shadow-2xl">
            <div className="space-y-4 p-5 sm:p-6">
              <p className="text-sm text-neutral-800">Something went wrong during compilation.</p>

              <details className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                <summary className="cursor-pointer select-none text-xs font-medium text-neutral-500">Technical details</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-neutral-700">
                  {compileErrorState.summary}
                  {compileErrorState.detail ? `\n\n${compileErrorState.detail}` : ""}
                </pre>
              </details>

              <div className="flex flex-wrap items-center gap-2">
                {compileErrorState.canShowFixWithAiCta ? (
                  <button
                    type="button"
                    onClick={() => {
                      startFixWithAiCooldown();
                      const lockKey = `${compileErrorState.code}:${compileErrorState.fingerprint}`;
                      const now = Date.now();
                      const cooldown = compileFixRequestCooldownRef.current;
                      const cooldownMs = 10 * 60_000;
                      if (cooldown && cooldown.fingerprint === lockKey && now < cooldown.until) return;
                      compileFixRequestCooldownRef.current = { fingerprint: lockKey, until: now + cooldownMs };
                      emitCompileErrorTelemetry('compile_error_fix_clicked', {
                        code: compileErrorState.code,
                        fingerprint: compileErrorState.fingerprint,
                        actionType: compileErrorState.actionType,
                        fixAction: compileErrorState.fixAction || null,
                      });
                      setCompileErrorState(null);
                      onCompileErrorFixRequest?.({
                        appId,
                        code: compileErrorState.code,
                        actionType: compileErrorState.actionType,
                        fixAction: compileErrorState.fixAction,
                        autoSend: true,
                        compileError: {
                          summary: compileErrorState.summary,
                          detail: compileErrorState.detail,
                          fingerprint: compileErrorState.fingerprint,
                        },
                      });
                    }}
                    disabled={isFixWithAiCoolingDown}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs bg-accent text-white hover:bg-[#e54f1a] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Fix with AI
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={compileErrorState.userAction === 'rebuild' ? rebuildPreview : retryApp}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs border border-black/15 bg-white text-black/80 hover:bg-black/5 transition-colors"
                >
                  {mapPreviewUserActionLabel(compileErrorState.userAction)}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {showPreviewSurface ? (
        <div className="relative w-full h-full">
          {showApplyRefreshingOverlay ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/85 backdrop-blur-[1px]">
              <div className="text-center max-w-md">
                <div className="kloner-dots" aria-hidden="true"><span className="kloner-dot" /><span className="kloner-dot" /><span className="kloner-dot" /></div>
                {renderLiveStatusLine({
                  uiStage: 'applying_changes',
                  uiMessage: 'Refreshing app with new changes…',
                  updatedAt: Date.now(),
                })}
              </div>
            </div>
          ) : null}
          {/* {hmrWsStatus === 'blocked' && showHmrWarning ? (
            <div className="absolute left-3 top-3 z-10 max-w-[min(520px,92vw)] rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-900 shadow-sm backdrop-blur-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-amber-900">Live updates may be blocked</div>
                  <div className="mt-0.5 text-[11px] text-amber-900/80">
                    The preview uses a WebSocket for Next.js HMR. Some VPNs, proxies, or blockers prevent it from connecting,
                    so you may need to reload to see changes.
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-amber-100"
                  aria-label="Hide live update warning"
                  onClick={() => setShowHmrWarning(false)}
                >
                  ×
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-amber-200 bg-white px-3 py-1 text-[11px] font-semibold text-amber-900 shadow-sm hover:bg-amber-100/60"
                  onClick={() => hardReloadPreview('hmr_ws_blocked_reload')}
                >
                  Reload preview
                </button>
                {!showPreviewUrlOverlay ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full border border-amber-200 bg-white px-3 py-1 text-[11px] font-semibold text-amber-900 shadow-sm hover:bg-amber-100/60"
                    onClick={() => {
                      setShowPreviewUrlOverlay(true);
                      setPreviewUrlDetailsOpen(false);
                    }}
                  >
                    Show URL
                  </button>
                ) : null}
              </div>
              <div className="mt-2 text-[11px] text-amber-900/70">
                If you’re on a VPN, try disabling it (or split-tunnel/allowlist <span className="font-mono">{CUSTOM_PREVIEW_HOST || DEFAULT_HUB_HOST}</span>).
              </div>
            </div>
          ) : null}
          {showPreviewUrlOverlay ? (
            <div className="absolute right-3 top-3 z-10 rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-xs text-black/70 shadow-sm backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <details
                  open={previewUrlDetailsOpen}
                  onToggle={(e) => {
                    const el = e.currentTarget as HTMLDetailsElement;
                    setPreviewUrlDetailsOpen(Boolean(el.open));
                  }}
                >
                  <summary className="cursor-pointer select-none">Embedded preview URL</summary>
                  <div className="mt-2 max-w-[min(720px,90vw)] break-all font-mono text-[11px] text-black/80">
                    {previewUrl}
                  </div>
                  <div className="mt-2">
                    <a
                      className="inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold text-black/70 shadow-sm hover:bg-black/5"
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in new tab
                    </a>
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold text-black/70 shadow-sm hover:bg-black/5"
                      onClick={() => {
                        hardReloadPreview('manual_reload_button');
                      }}
                    >
                      Reload preview
                    </button>
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold text-black/70 shadow-sm hover:bg-black/5"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(previewUrl);
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Copy URL
                    </button>
                  </div>
                </details>

                <button
                  type="button"
                  className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-black/5"
                  aria-label="Hide preview URL"
                  onClick={() => {
                    setPreviewUrlDetailsOpen(false);
                    setShowPreviewUrlOverlay(false);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ) : null} */}
          {externalPreviewMode ? (
            <div className="h-full w-full flex items-center justify-center p-6">
              <div className="w-full max-w-xl rounded-2xl border border-black/10 bg-white p-6 text-center shadow-sm">
                <div className="text-lg font-semibold text-black/90">Preview opened outside iframe</div>
                <div className="mt-2 text-sm text-black/70">
                  Safari may block embedded preview routing in iframes, so we opened your live preview in a separate tab automatically.
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      forceExternalPreviewRef.current = false;
                      clearSafariEmbedFailure(activePreviewUrl);
                      setExternalPreviewMode(false);
                      setExternalPreviewAutoOpenFailed(false);
                      iframeLoadedSuccessfullyRef.current = false;
                      setIframeKey((k) => k + 1);
                      setIsLoading(true);
                      setIsPolling(true);
                      setLoadingStatus('Retrying embedded preview…');
                      try { onPreviewReadyChange?.(false); } catch { }
                    }}
                    className="inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-black/80 hover:bg-black/5"
                  >
                    Try embedded preview
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      let opened: Window | null = null;
                      try {
                        opened = window.open(activePreviewUrl, '_blank', 'noopener,noreferrer');
                      } catch {
                        opened = null;
                      }
                      setExternalPreviewAutoOpenFailed(!opened);
                    }}
                    className="inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-black/80 hover:bg-black/5"
                  >
                    Open preview tab
                  </button>
                  <button
                    type="button"
                    onClick={() => hardReloadPreview('external_preview_reload')}
                    className="inline-flex items-center rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-[#e54f1a]"
                  >
                    Restart preview session
                  </button>
                </div>
                {externalPreviewAutoOpenFailed ? (
                  <div className="mt-3 text-xs text-amber-700">
                    Your browser blocked auto-open. Click “Open preview tab”.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={activePreviewUrl}
            className="w-full h-full border border-black/10 rounded-lg"
            title="App Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            onLoad={(event) => {
              console.log('[WebContainerRunner] iframe onLoad (navigation complete):', previewUrl);

              try {
                const iframe = event.currentTarget as HTMLIFrameElement | null;
                const currentPath = iframe?.contentWindow?.location?.pathname || null;
                const normalizedPath = normalizeAppRouteFromPath(currentPath);
                onNavigatePathChange?.(normalizedPath);
              } catch {
                // ignore
              }

              if (navigatePath) {
                sendPreviewNavigateCommand(navigatePath);
              }

              if (iframeCriticalTimeoutRef.current) {
                clearTimeout(iframeCriticalTimeoutRef.current);
                iframeCriticalTimeoutRef.current = null;
              }

              const warnCtx = iframeWarnContextRef.current;
              if (warnCtx && warnCtx.previewUrl === String(activePreviewUrl || '')) {
                const elapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : Date.now() - warnCtx.warnedAt;
                void reportPreviewAlert({
                  appId,
                  code: warnCtx.code,
                  action: 'preview_recovered_after_warn',
                  severity: 'info',
                  statusCode: 200,
                  status: 'recovered_after_warn',
                  reason: 'preview_recovered_after_warn',
                  message: 'Preview iframe recovered after slow-start warning before terminal failure.',
                  elapsedMs,
                  previewUrl: activePreviewUrl,
                  backendStatusData: lastBackendStatusRef.current,
                }).catch(() => undefined);
                iframeWarnContextRef.current = null;
              }

              clearSafariEmbedFailure(activePreviewUrl);

              if (iframePostLoadTimeoutRef.current) {
                clearTimeout(iframePostLoadTimeoutRef.current);
                iframePostLoadTimeoutRef.current = null;
              }

              // Iframe load can be a real app OR a "Not Found"/fallback page.
              // Only declare the preview "ready" when the backend contract says `ready === true`.
              iframeLoadedSuccessfullyRef.current = true;
              appLoadedSuccessfullyRef.current = true;

              // For the chat UX we want to unlock when the preview is actually usable.
              // Backend `ready === true` is authoritative; the shared presentation helper
              // only upgrades to live when the backend is connectable or the iframe is already healthy.
              const uiReady = backendReadyRef.current || hmrWsStatus === 'ok' || previewPresentation.shouldShowLivePreview;

              if (backendReadyRef.current) {
                setError(null);
                setCanRetry(false);
                setIsLoading(false);
                setConnectingToExisting(false);
                setLoadingStatus('');
                iframePostLoadRecoveryCountRef.current = 0;
                // Once the app is actually running, hide the URL overlay for the remainder of this session.
                setPreviewUrlDetailsOpen(false);
                setShowPreviewUrlOverlay(false);
                try { onPreviewReadyChange?.(true); } catch { }
                stopAllTimers();
                if (isPolling) setIsPolling(false);
                if (currentStatusData) setCurrentStatusData(null);

                const readyUrl = lastReadyUrlRef.current || previewUrl;
                const serverKind = lastAppServerKindRef.current;

                // If the backend says we're still on the fallback server, an iframe refresh won't help.
                // Trigger the same force-fresh rebuild flow once.
                if (readyUrl && serverKind === 'fallback') {
                  requestForceFreshRebuild('status_appServerKind_fallback_after_ready', readyUrl);
                }
              } else if (uiReady) {
                // Don't block chat just because the backend hasn't flipped the final `ready` flag yet.
                try { onPreviewReadyChange?.(true); } catch { }
                if (loadingStatus) setLoadingStatus('');
                iframePostLoadRecoveryCountRef.current = 0;
                // Keep polling in the background until `ready === true`.
                if (!isPolling) setIsPolling(true);
              } else {
                try { onPreviewReadyChange?.(false); } catch { }
                // Keep polling in the background until `ready === true`.
                if (!isPolling) setIsPolling(true);

                // White-screen watchdog: iframe navigated, but preview didn't become interactive.
                // Recover once automatically, then escalate on strict browsers (Safari/Edge)
                // to external mode instead of leaving a blank frame.
                iframePostLoadTimeoutRef.current = setTimeout(() => {
                  if (backendReadyRef.current) return;
                  const currentUrl = previewUrlRef.current;
                  if (!currentUrl) return;
                  if (iframePostLoadRecoveryCountRef.current < 1) {
                    iframePostLoadRecoveryCountRef.current += 1;
                    hardReloadPreview('iframe_loaded_but_not_interactive');
                    return;
                  }

                  if (isHubPreviewUrl(currentUrl) && (isSafariLikeBrowser() || isEdgeLikeBrowser())) {
                    switchToExternalPreviewMode(currentUrl, 'iframe_loaded_but_not_interactive_strict_browser');
                    return;
                  }

                  setCanRetry(true);
                  setError('Preview loaded but did not become interactive. Refresh first. If it still stays blank, use Rebuild to start a fresh machine.');
                }, 12000);
              }
              // Reset asset failure count on successful load
              assetFailureCountRef.current = 0;
              // Clear the load timeout since we succeeded
              if (iframeLoadTimeoutRef.current) {
                clearTimeout(iframeLoadTimeoutRef.current);
                iframeLoadTimeoutRef.current = null;
              }

              // No content validation here (CORS). Readiness comes from backend polling.
            }}
            onError={() => {
              console.log('Iframe failed to load - URL may be unreachable:', previewUrl);
              try { onPreviewReadyChange?.(false); } catch { }

              // If backend hasn't declared ready, treat this as transient and keep polling.
              if (!backendReadyRef.current) {
                const elapsedMs = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : 0;
                const backendSignal = classifyBackendSignal(lastBackendStatusRef.current);
                if (backendSignal.hardFailure) {
                  reportLoadingIssueOnce(`iframe-onerror-hard-failure:${appId}:${pollingCodeRef.current || 'unknown'}:${String(activePreviewUrl || '')}:${backendSignal.timeoutReason || 'hard'}`, {
                    appId,
                    code: pollingCodeRef.current || undefined,
                    action: 'preview_backend_hard_failure',
                    severity: 'critical',
                    statusCode: 504,
                    status: 'iframe_onerror_waiting_for_ready',
                    reason: backendSignal.timeoutReason || 'iframe_onerror_waiting_for_ready',
                    message: 'Preview iframe onError fired and backend signaled an unrecoverable startup failure.',
                    elapsedMs,
                    previewUrl: activePreviewUrl,
                    requestId: backendSignal.requestId,
                    jobId: backendSignal.jobId,
                    backendStatusData: lastBackendStatusRef.current,
                  });
                } else if (elapsedMs >= PREVIEW_IFRAME_CRITICAL_MS) {
                  reportLoadingIssueOnce(`iframe-onerror-critical:${appId}:${pollingCodeRef.current || 'unknown'}:${String(activePreviewUrl || '')}`, {
                    appId,
                    code: pollingCodeRef.current || undefined,
                    action: 'preview_slow_start_critical',
                    severity: 'critical',
                    statusCode: 504,
                    status: 'iframe_onerror_waiting_for_ready',
                    reason: 'iframe_onerror_waiting_for_ready',
                    message: 'Preview iframe onError persisted past critical timeout while backend was still not ready.',
                    elapsedMs,
                    previewUrl: activePreviewUrl,
                    requestId: backendSignal.requestId,
                    jobId: backendSignal.jobId,
                    backendStatusData: lastBackendStatusRef.current,
                  });
                } else if (elapsedMs >= PREVIEW_IFRAME_WARN_MS) {
                  reportLoadingIssueOnce(`iframe-onerror-warn:${appId}:${pollingCodeRef.current || 'unknown'}:${String(activePreviewUrl || '')}`, {
                    appId,
                    code: pollingCodeRef.current || undefined,
                    action: 'preview_slow_start_warn',
                    severity: 'warning',
                    statusCode: 200,
                    status: 'iframe_onerror_waiting_for_ready',
                    reason: 'preview_slow_start_iframe_waiting_for_ready',
                    message: 'Preview is still starting; iframe reported a transient load error while backend remained in a recoverable state.',
                    elapsedMs,
                    previewUrl: activePreviewUrl,
                    requestId: backendSignal.requestId,
                    jobId: backendSignal.jobId,
                    backendStatusData: lastBackendStatusRef.current,
                  });
                }

                setError(null);
                setCanRetry(false);
                setIsLoading(false);
                setIsPolling(true);
                setConnectingToExisting(false);
                setLoadingStatus('');
                iframeLoadedSuccessfullyRef.current = false;
                appLoadedSuccessfullyRef.current = true;
                return;
              }

              // Check if this looks like a DNS/network error or preview routing issue
              if (isHubPreviewUrl(activePreviewUrl)) {
                if (isSafariLikeBrowser()) {
                  switchToExternalPreviewMode(activePreviewUrl, 'safari_iframe_onerror_hub_preview');
                  return;
                }
                setError('Preview couldn’t load in this iframe. The embedded preview may be blocked by browser routing/cookie settings, or it may still be starting. We will automatically refresh the preview in a few seconds.');
                setCookieRecoveryPromptVisible(true);
                setCanRetry(true);
                reportCookieIframeBlocked({
                  previewUrl,
                  reason: 'iframe_onerror_hub_cookie_or_routing_issue',
                  message: 'Iframe onError on hub preview URL; likely cookie/routing block in embedded context.',
                });
                setIsLoading(false);
                setIsPolling(false);
                setConnectingToExisting(false);
                setCurrentStatusData(null);
                setLoadingStatus('');
                iframeLoadedSuccessfullyRef.current = false;
                appLoadedSuccessfullyRef.current = false;
                setPreviewUrl(null); // Hide the iframe
                try { onPreviewReadyChange?.(false); } catch { }
                scheduleAutomaticPreviewRestart('iframe_onerror_hub', 6000);
              } else {
                const latestStatus = lastBackendStatusRef.current;
                const latestSignal = classifyBackendSignal(latestStatus);
                const latestRetryAfterSeconds = asRetryAfterSeconds((latestStatus as any)?.retryAfterSeconds ?? (latestStatus as any)?.retry_after_seconds ?? null);
                const latestRestartPending = Boolean((latestStatus as any)?.restartPending || (latestStatus as any)?.queued || (latestStatus as any)?.outcome === 'restart_pending');
                const latestRetryable = Boolean((latestStatus as any)?.retryable || (latestStatus as any)?.retryAfterSeconds != null || (latestStatus as any)?.retry_after_seconds != null);

                if (!latestSignal.hardFailure && (latestSignal.recoverable || latestRestartPending || latestRetryable)) {
                  const retryDelayMs = latestRetryAfterSeconds !== null ? Math.max(1_000, latestRetryAfterSeconds * 1000) : POLL_INTERVAL_MS;
                  reportLoadingIssueOnce(`iframe-onerror-recoverable:${appId}:${pollingCodeRef.current || 'unknown'}:${String(activePreviewUrl || '')}`, {
                    appId,
                    code: pollingCodeRef.current || undefined,
                    status: 'iframe_onerror_recoverable',
                    reason: latestSignal.timeoutReason || (latestRestartPending ? 'restart_pending' : 'retryable_pending'),
                    message: latestRetryAfterSeconds !== null
                      ? `Preview iframe could not load yet, but the backend said to retry in ${latestRetryAfterSeconds}s.`
                      : 'Preview iframe could not load yet, but the backend said to keep retrying.',
                    ageMs: pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined,
                    previewUrl: activePreviewUrl,
                    requestId: latestSignal.requestId,
                    jobId: latestSignal.jobId,
                    backendStatusData: latestStatus,
                  });

                  setError(null);
                  setCookieRecoveryPromptVisible(false);
                  setCanRetry(false);
                  setIsLoading(true);
                  setIsPolling(true);
                  setConnectingToExisting(false);
                  setLoadingStatus(latestRetryAfterSeconds !== null ? `Preview is still starting. Retrying in ${latestRetryAfterSeconds}s…` : 'Preview is still starting. Retrying automatically…');
                  scheduleAutomaticPreviewRestart('iframe_onerror_recoverable', retryDelayMs);
                } else {
                  reportLoadingIssueOnce(`iframe-onerror-unreachable:${appId}:${pollingCodeRef.current || 'unknown'}:${String(activePreviewUrl || '')}`, {
                    appId,
                    code: pollingCodeRef.current || undefined,
                    status: 'iframe_onerror_unreachable_preview',
                    reason: 'iframe_onerror_unreachable_preview',
                    message: 'Preview iframe onError fired and the backend did not report a recoverable attach state.',
                    ageMs: pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined,
                    previewUrl: activePreviewUrl,
                    browser: detectBrowserLabel(),
                    userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : 'unknown',
                  });

                  setError(`Unable to load preview. The deployment may still be starting up or has failed. Please try again in a few minutes.`);
                  setCookieRecoveryPromptVisible(false);
                  setCanRetry(true);
                  setIsLoading(false);
                  setIsPolling(false);
                  setConnectingToExisting(false);
                  setCurrentStatusData(null);
                  setLoadingStatus('');
                  iframeLoadedSuccessfullyRef.current = false;
                  appLoadedSuccessfullyRef.current = false;
                  setPreviewUrl(null); // Hide the iframe
                  try { onPreviewReadyChange?.(false); } catch { }
                }
              }
            }}
          />
          )}
        </div>
      ) : showTerminalPreviewErrorCard || compileErrorState ? (
        <div className="flex-1 flex items-center justify-center px-4">
          {(() => {
            const statusCopy = `${String(previewFailureTitle || '')} ${String(previewFailureMessage || '')}`.toLowerCase();
            const isPositiveStatus = /\bready\b|\bready to\b|\brunning\b|\bcompleted\b|\bfinished\b|\bsuccess\b|\bok\b|\brestart preview\b/.test(statusCopy);

            return (
          <div className="w-full max-w-lg rounded-[1.5rem] border border-neutral-300 bg-[linear-gradient(180deg,rgba(245,245,245,0.98),rgba(255,255,255,1))] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-neutral-200 text-neutral-700 ring-1 ring-neutral-300">
                {isPositiveStatus ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-neutral-900">{previewFailureTitle}</p>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-neutral-700">{previewFailureMessage}</p>
                <button
                  type="button"
                  onClick={retryApp}
                  className="mt-3 inline-flex items-center rounded-full border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-100 transition hover:bg-neutral-700"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
            );
          })()}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            {isPolling && !terminalPreviewStatus ? (
              // Simple, clean polling state with 3-dot loader
              <div className="space-y-4">
                <div className="kloner-dots" aria-hidden="true"><span className="kloner-dot" /><span className="kloner-dot" /><span className="kloner-dot" /></div>
                {renderLiveStatusLine(
                  currentStatusData
                    ? { ...currentStatusData, updatedAt: currentStatusData?.updatedAt ?? Date.now() }
                    : pollingRetryCountRef.current === 0
                      ? {
                        uiStage: 'building_app',
                        uiTitle: 'Building your app',
                        uiMessage: 'This can take a minute or two',
                        updatedAt: Date.now(),
                      }
                      : pollingRetryCountRef.current < maxPollingRetries
                        ? {
                          uiStage: 'still_building',
                          uiTitle: 'Still building',
                          uiMessage: 'Checking progress…',
                          updatedAt: Date.now(),
                        }
                        : {
                          uiStage: 'connection_timeout',
                          uiTitle: 'Connection timeout',
                          uiMessage: 'Unable to verify build status',
                          updatedAt: Date.now(),
                        }
                )}
                {renderBuildChecklist(currentStatusData)}
                {pollNetworkWarning ? (
                  <div className="mx-auto mt-3 max-w-xl rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
                    {pollNetworkWarning}
                  </div>
                ) : null}
              </div>
            ) : (
              // Initial loading state
              <>
                <div className="kloner-dots" aria-hidden="true"><span className="kloner-dot" /><span className="kloner-dot" /><span className="kloner-dot" /></div>
                {renderLiveStatusLine({
                  uiStage: connectingToExisting ? 'reconnecting' : 'starting_app',
                  uiTitle: connectingToExisting ? 'Connecting to existing machine' : 'Starting your app',
                  uiMessage: connectingToExisting ? 'Reconnecting to your saved session' : 'Setting up your environment',
                  updatedAt: Date.now(),
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}