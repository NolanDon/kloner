// components/WebContainerRunner.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from "@/lib/firebase";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";
import { useAuth } from "@/src/hooks/useAuth";

// React 18 StrictMode in dev intentionally mounts/unmounts twice.
// If we eagerly stop the local runner on unmount, we create a start/stop/start loop.
// This small scheduler avoids killing the process when a remount happens immediately.
const pendingCleanupTimers = new Map<string, number>();

interface WebContainerRunnerProps {
  appId: string;
  files: { [path: string]: { content: string; lastModified: number } };
  onFileChange?: (path: string, content: string) => void;
  onPreviewReadyChange?: (ready: boolean) => void;
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
  navigatePath?: string | null;
  navigatePathToken?: number;
}

export default function WebContainerRunner({ appId, files, onFileChange, onPreviewReadyChange, onBackendReady, onRequestRebuild, onCompileErrorFixRequest, reloadToken, applyToken, restartToken, reconnectToken, forceFreshStart, pollingConfig, navigatePath, navigatePathToken }: WebContainerRunnerProps) {

  type DebugEvent = {
    ts: number;
    kind: string;
    data?: any;
  };

  const debugEventsRef = useRef<DebugEvent[]>([]);
  const debugPersistTimerRef = useRef<number | null>(null);
  const debugKeyRef = useRef<string>(`kloner.appprevieweditor.aiAgentEvents.${String(appId || 'unknown')}`);

  const schedulePersistDebugEvents = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (debugPersistTimerRef.current != null) return;
    debugPersistTimerRef.current = window.setTimeout(() => {
      debugPersistTimerRef.current = null;
      try {
        const key = debugKeyRef.current;
        const payload = JSON.stringify(debugEventsRef.current.slice(-500));
        window.localStorage.setItem(key, payload);
        (window as any).__klonerAppPreviewEditorAiAgentEvents = (window as any).__klonerAppPreviewEditorAiAgentEvents || {};
        (window as any).__klonerAppPreviewEditorAiAgentEvents[String(appId || 'unknown')] = debugEventsRef.current.slice(-500);
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

    debugEventsRef.current.push({ ts, kind, data: safeData });
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
    noCredit: boolean;
    actionType: 'quick_fix_compile';
    fixAction?: string;
    canShowFreeFixCta: boolean;
  } | null>(null);
  const [cookieRecoveryPromptVisible, setCookieRecoveryPromptVisible] = useState(false);
  const [externalPreviewMode, setExternalPreviewMode] = useState(false);
  const [externalPreviewAutoOpenFailed, setExternalPreviewAutoOpenFailed] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [startAttempt, setStartAttempt] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isApplyRefreshing, setIsApplyRefreshing] = useState(false);
  const [currentStatusData, setCurrentStatusData] = useState<any>(null); // Store latest status data for UI
  const [connectingToExisting, setConnectingToExisting] = useState(false); // Track if connecting to existing machine
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
  const backendReadyRef = useRef(false); // Backend contract: `ready === true` is authoritative
  const lastUiStageRef = useRef<string>('');
  const lastStatusRef = useRef<string>('');
  const statusPollTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track status polling timeout
  const iframeLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track iframe load timeout
  const iframePostLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Detect white-screen after iframe navigation
  const automaticRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track automatic retry timeout
  const pollStartedAtRef = useRef<number>(0);
  const latestDeploymentUrlRef = useRef<string>('');
  const hubStatusUrlRef = useRef<string | null>(null);
  const lastReportedStatusRef = useRef<string>('');
  const lastReadyUrlRef = useRef<string | null>(null);
  const lastBackendReadyNotifyRef = useRef<string | null>(null);
  const autoRebuildByCodeRef = useRef<Record<string, true>>({});
  const compileErrorSeenByFingerprintRef = useRef<Record<string, true>>({});
  const compileErrorActiveFingerprintRef = useRef<string | null>(null);
  const iframePostLoadRecoveryCountRef = useRef<number>(0);
  const lastAppServerKindRef = useRef<'fallback' | 'next-dev' | 'next-prod' | ''>('');
  const stickyProgressByCodeRef = useRef<Record<string, number>>({});
  const lastTimeoutReportKeyRef = useRef<string>('');

  // Default status polling interval while the preview is booting/compiling.
  // We keep this relatively infrequent; readiness is primarily driven by the
  // preview URL/iframe once available.
  const POLL_INTERVAL_MS = 1_500;

  // Throttle: regardless of code path, never issue status checks more frequently
  // than this (prevents duplicate loops and tight retry paths from spamming).
  const MIN_STATUS_FETCH_INTERVAL_MS = 1_200;
  const lastStatusFetchAtRef = useRef<number>(0);
  const HARD_POLL_TIMEOUT_MS = 12 * 60 * 1000;

  const DEFAULT_HUB_HOST = 'tracksite-hub.fly.dev';
  const CUSTOM_PREVIEW_HOST = String(process.env.NEXT_PUBLIC_PREVIEW_HOST || 'preview.kloner.app').trim().toLowerCase();
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

    try {
      const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : undefined);
      const host = u.hostname.toLowerCase();
      if (isHubHost(host)) {
        // Never navigate to hub root; hub previews must be /preview/<code>(/path)? with a viewer token.
        const parts = u.pathname.split('/').filter(Boolean);
        return parts.length >= 2 && parts[0] === 'preview' && Boolean(parts[1]);
      }
      // For non-hub URLs, accept http(s) URLs.
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const requestForceFreshRebuild = (reason: string, previewUrl: string) => {
    if (typeof window === 'undefined') return;
    const code = derivePreviewCodeFromUrl(previewUrl) || 'unknown';
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
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }
  };

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

  const reportPreviewTimeout = async (payload: {
    appId: string;
    code?: string;
    status?: string;
    message: string;
    ageMs?: number;
    previewUrl?: string | null;
    browser?: string;
    userAgent?: string;
    reason?: string;
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
    const compileError = statusData?.compileError && typeof statusData.compileError === 'object' ? statusData.compileError : {};
    const summary = String(compileError?.summary || '').trim();
    const detail = String(compileError?.detail || statusData?.error || statusData?.uiMessage || '').trim();
    const fingerprint = String(compileError?.fingerprint || `${code}:${summary || 'compile_error'}`).trim();
    const quickFixEligible = compileError?.quickFixEligible === true;
    const noCredit = compileError?.noCredit === true;
    const fixActionFromCompileError = String(compileError?.fixAction || '').trim();

    const status = String(statusData?.status || '').toLowerCase();
    const uiStage = String(statusData?.uiStage || '').toLowerCase();
    const quickActions = Array.isArray(statusData?.quickActions) ? statusData.quickActions : [];
    const quickFixAction = quickActions.find((action: any) => String(action?.type || '').toLowerCase() === 'quick_fix_compile');
    const quickFixNoCredit = quickFixAction?.noCredit === true;
    const fixActionId = String(fixActionFromCompileError || quickFixAction?.id || quickFixAction?.actionId || '').trim();

    const compileErrorActive =
      Boolean(summary) ||
      uiStage === 'compile_error' ||
      (status === 'error' && Boolean(quickFixAction));

    if (!compileErrorActive) return null;

    const normalizedSummary = summary || 'Compilation failed while preparing your preview.';
    return {
      code,
      summary: normalizedSummary,
      detail,
      fingerprint,
      quickFixEligible,
      noCredit,
      actionType: 'quick_fix_compile' as const,
      fixAction: fixActionId || undefined,
      canShowFreeFixCta: quickFixEligible && noCredit && Boolean(quickFixAction) && quickFixNoCredit,
    };
  }, []);

  // Helper function to get stored container code for this app
  const getStoredContainerCode = async (appId: string, user: any): Promise<string | null> => {
    // First try localStorage
    try {
      const stored = localStorage.getItem(`webcontainer_${appId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.code && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) { // 24 hours
          return parsed.code;
        }
      }
    } catch {
      // Ignore localStorage errors
    }

    // Also check Firebase for stored container codes
    try {
      if (user?.uid) {
        const docRef = doc(db, 'kloner_users', user.uid, 'kloner_apps', appId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data?.containerCode && data?.containerCodeTimestamp &&
            Date.now() - data.containerCodeTimestamp < 24 * 60 * 60 * 1000) { // 24 hours
            // Store it back in localStorage for faster access next time
            try {
              localStorage.setItem(`webcontainer_${appId}`, JSON.stringify({
                code: data.containerCode,
                timestamp: data.containerCodeTimestamp
              }));
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

  // Helper function to store container code for this app
  const storeContainerCode = async (appId: string, code: string, user: any) => {
    try {
      localStorage.setItem(`webcontainer_${appId}`, JSON.stringify({ code, timestamp: Date.now() }));
    } catch {
      // Ignore storage errors
    }

    // Also store in Firebase for persistence across browsers/sessions
    try {
      if (user?.uid) {
        const docRef = doc(db, 'kloner_users', user.uid, 'kloner_apps', appId);
        await updateDoc(docRef, {
          containerCode: code,
          containerCodeTimestamp: Date.now(),
          updatedAt: new Date(),
        });
        console.log(`💾 Stored container code ${code} for app ${appId} in Firebase`);
      }
    } catch (error) {
      console.error('Failed to store container code in Firebase:', error);
    }
  };

  // Helper function to clear stored container code
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
    setConnectingToExisting(false); // Reset connection state
    lastStartKeyRef.current = null;
    retryScheduledRef.current = false;
    totalAttemptsRef.current = 0; // Reset circuit breaker on manual retry
    assetFailureCountRef.current = 0; // Reset asset failure count
    appLoadedSuccessfullyRef.current = false; // Reset server success flag
    iframeLoadedSuccessfullyRef.current = false; // Reset iframe success flag
    pollingCodeRef.current = null; // Reset polling code
    compileErrorActiveFingerprintRef.current = null;
    iframePostLoadRecoveryCountRef.current = 0;
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }

    // Do not clear stored container code on retry.
    // Retry should attempt to reconnect to the saved machine first.
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
  const forceExternalPreviewRef = useRef(false);
  const safariEmbedFailureByCodeRef = useRef<Record<string, number>>({});
  const reconnectOnlyRef = useRef(false);
  const filesRef = useRef(files);
  const startRunIdRef = useRef(0);
  const effectStartedAtRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ensuredConfigRef = useRef(false);

  const reportCookieIframeBlocked = (args: { previewUrl?: string | null; reason: string; message: string }) => {
    if (typeof window === 'undefined') return;
    const ua = String(window.navigator?.userAgent || 'unknown');
    const browser = detectBrowserLabel();
    const key = `${appId}:${args.reason}:${String(args.previewUrl || '')}:${browser}`;
    if (lastCookieBlockReportKeyRef.current === key) return;
    lastCookieBlockReportKeyRef.current = key;

    void reportPreviewTimeout({
      appId,
      code: pollingCodeRef.current || undefined,
      status: 'iframe_cookie_blocked',
      reason: args.reason,
      message: args.message,
      previewUrl: args.previewUrl || previewUrlRef.current,
      browser,
      userAgent: ua,
    });
  };

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

  const switchToExternalPreviewMode = (url: string, reason: string) => {
    const normalizedUrl = normalizePreviewUrlHost(url);
    if (!normalizedUrl) return;

    markSafariEmbedFailure(normalizedUrl);

    forceExternalPreviewRef.current = true;
    setExternalPreviewMode(true);
    setError(null);
    setCanRetry(false);
    setCookieRecoveryPromptVisible(false);
    setIsLoading(false);
    setIsPolling(false);
    setConnectingToExisting(false);

    reportCookieIframeBlocked({
      previewUrl: normalizedUrl,
      reason,
      message: 'Safari iframe preview failed repeatedly; switching to external preview fallback.',
    });

    let opened: Window | null = null;
    try {
      opened = window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      opened = null;
    }
    setExternalPreviewAutoOpenFailed(!opened);
    try { onPreviewReadyChange?.(true); } catch { }
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
      const status = String((raw as any)?.status || '').toLowerCase();
      const uiStage = String((raw as any)?.uiStage || '').toLowerCase();
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
        if (status === 'booting' || status === 'starting' || status === 'creating_machine') return 20;
        if (transitioning) return 90;
        return 0;
      })();

      const nextProgress = explicitProgress == null ? inferredProgress : explicitProgress;
      const prev = typeof stickyProgressByCodeRef.current[code] === 'number' ? stickyProgressByCodeRef.current[code]! : 0;
      const sticky = Math.max(prev, nextProgress);
      stickyProgressByCodeRef.current[code] = sticky;

      return { ...raw, uiProgress: sticky, __transitioning: transitioning };
    } catch {
      return raw;
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
    if (normalized !== previewUrl) {
      setPreviewUrl(normalized);
    }
  }, [previewUrl]);

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

  // Track a stable base URL for reloads (strip only cache-busting params).
  useEffect(() => {
    if (!previewUrl) return;
    try {
      const isRelative = String(previewUrl).startsWith('/');
      const u = new URL(isRelative ? `${window.location.origin}${previewUrl}` : String(previewUrl));
      // IMPORTANT: keep `t` (viewer token). Only strip our cache-buster.
      u.searchParams.delete('cb');
      proxyBaseRef.current = isRelative ? `${u.pathname}${u.search}${u.hash}` : u.toString();
    } catch {
      // Last-resort fallback: never strip query params (it may contain the viewer token `t`).
      const raw = String(previewUrl);
      proxyBaseRef.current = raw.replace(/([?&])cb=[^&#]+(&)?/g, (m, sep, trailing) => (sep === '?' && trailing ? '?' : sep === '?' ? '' : trailing ? '&' : '')).replace(/[?&]$/, '') || raw;
    }
  }, [previewUrl]);

  // Allow the parent to navigate the preview iframe to a specific path under /preview/:code.
  // This is used for a visible HMR smoke-test page.
  useEffect(() => {
    if (typeof navigatePathToken !== 'number') return;
    if (navigatePathToken <= 0) return;
    if (lastNavigatePathTokenRef.current === navigatePathToken) return;
    lastNavigatePathTokenRef.current = navigatePathToken;

    if (!navigatePath) return;
    if (!proxyBaseRef.current) return;

    const nextBase = withPreviewPath(proxyBaseRef.current, navigatePath);
    proxyBaseRef.current = nextBase;
    setPreviewUrl(withCacheBust(nextBase));
  }, [navigatePath, navigatePathToken]);

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

    pollingRetryCountRef.current = 0;
    containerNotFoundCountRef.current = 0;
    assetFailureCountRef.current = 0;
    appLoadedSuccessfullyRef.current = false;
    iframeLoadedSuccessfullyRef.current = false;
    pollingCodeRef.current = null;
    backendReadyRef.current = false;
    pollStartedAtRef.current = 0;
    iframePostLoadRecoveryCountRef.current = 0;
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

    pollingRetryCountRef.current = 0;
    containerNotFoundCountRef.current = 0;
    assetFailureCountRef.current = 0;
    appLoadedSuccessfullyRef.current = false;
    iframeLoadedSuccessfullyRef.current = false;
    pollingCodeRef.current = null;
    backendReadyRef.current = false;
    pollStartedAtRef.current = 0;
    iframePostLoadRecoveryCountRef.current = 0;
    if (iframePostLoadTimeoutRef.current) {
      clearTimeout(iframePostLoadTimeoutRef.current);
      iframePostLoadTimeoutRef.current = null;
    }
    latestDeploymentUrlRef.current = '';
    hubStatusUrlRef.current = null;
    lastReportedStatusRef.current = '';
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
        }

        const startKey = `${appId}|${startAttempt}|${restartToken ?? 0}|${reconnectToken ?? 0}|${forceFreshStart ?? 0}`;
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
        setConnectingToExisting(false);
        pollingRetryCountRef.current = 0; // Reset retry count
        containerNotFoundCountRef.current = 0; // Reset 404 counter

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
          setLoadingStatus('Starting new machine... (This may take several minutes for first-time builds)');
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

                // Allow containers that are either:
                // 1. In allowed statuses, OR
                // 2. Booting with high progress (90%+)
                //
                // IMPORTANT: do NOT treat "stopped" as reusable even if it still has a URL.
                // A stopped Fly machine can continue to return a proxied/edge page that makes
                // the iframe look "loaded" while the app is actually dead.
                const isAllowedStatus =
                  allowedStatuses.includes(statusData.status) ||
                  (statusData.status === 'booting' && statusData.uiProgress >= 90);

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
                      setPreviewUrl(statusData.url);
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
                    setPreviewUrl(statusData.url);
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
                            setPreviewUrl(statusData.url);
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
                  } else if (statusData.status === 'booting' && statusData.uiProgress < 50 && (!statusData.url || !statusData.machineId)) {
                    // Only reject booting containers with low progress if they don't have URL/machineId
                    console.log(`⏳ Container ${existingCode} is booting at ${statusData.uiProgress}% with incomplete info, will create new one`);
                  } else {
                    console.log(`ℹ️ Container ${existingCode} (${statusData.status}, ${statusData.uiProgress}%) not ideal but has URL/machineId, will try fallback connection`);
                  }
                }

                // Try fallback connections for containers that have URL and machineId, regardless of status
                // (as long as they're not in error state)
                if (statusData.url && statusData.machineId && statusData.status !== 'error' && statusData.status !== 'stopped') {
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
                    setPreviewUrl(statusData.url);
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
                  setPreviewUrl(statusData.url);
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
                    setPreviewUrl(url);
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
        setLoadingStatus('Starting new machine... (This may take several minutes for first-time builds)');

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
          if (!file || typeof file !== 'object' || !file.content || typeof file.content !== 'string') {
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

        const postWebcontainer = async (attempt: number): Promise<Response> => {
          const headers = await getAuthenticatedHeaders();
          return fetch('/api/webcontainer', {
            method: 'POST',
            headers,
            credentials: "include",
            cache: 'no-store',
            body: JSON.stringify(requestBody),
          });
        };

        await ensureAppScopeCookie();
        let response = await postWebcontainer(0);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as any));
          const errorMsg = String(errorData?.error || 'Failed to start app');
          const errorCode = String(errorData?.code || '').trim();
          const isScopeProblem =
            errorCode === 'MISSING_APP_SCOPE' ||
            errorCode === 'INVALID_APP_SCOPE' ||
            errorMsg.toLowerCase().includes('app scope');

          // CSRF can drift (cookie/header mismatch). Refresh token and retry once.
          if (response.status === 403 && errorMsg.toLowerCase().includes('csrf')) {
            console.warn('Webcontainer start hit CSRF 403; retrying once with fresh CSRF token');
            response = await postWebcontainer(1);
          } else if (response.status === 403 && isScopeProblem) {
            console.warn('Webcontainer start hit app-scope 403; refreshing scope cookie and retrying once');
            await ensureAppScopeCookie();
            response = await postWebcontainer(1);
          } else {
            throw new Error(errorMsg);
          }
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as any));
          throw new Error(String(errorData?.error || 'Failed to start app'));
        }

        const data = await response.json();
        console.log('Container creation response:', data);
        const { code } = data;

        if (!code) {
          throw new Error('No tracking code received from server');
        }

        console.log('App creation started, tracking code:', code);
        pollingCodeRef.current = code;

        // Store the container code for future connections
        await storeContainerCode(appId, code, user);

        setIsPolling(true); // Enter polling state
        setLoadingStatus(''); // Clear loading status when entering polling state
        pollingRetryCountRef.current = 0; // Reset retry count
        containerNotFoundCountRef.current = 0; // Reset 404 counter

        // Start polling for status
        const pollStatus = async () => {
          if (startRunIdRef.current !== runId) return; // Component was unmounted

          // Hard timeout guard (12 minutes)
          if (pollStartedAtRef.current && Date.now() - pollStartedAtRef.current > HARD_POLL_TIMEOUT_MS) {
            console.error('[WebContainerRunner] Preview polling timed out');
            const timedOutAgeMs = Date.now() - pollStartedAtRef.current;
            const timeoutReportKey = `hard-timeout:${appId}:${code}`;
            if (lastTimeoutReportKeyRef.current !== timeoutReportKey) {
              lastTimeoutReportKeyRef.current = timeoutReportKey;
              void reportPreviewTimeout({
                appId,
                code,
                status: 'poll_timeout',
                message: 'Preview polling exceeded 12-minute hard timeout in WebContainerRunner.',
                ageMs: timedOutAgeMs,
                previewUrl: previewUrlRef.current,
              });
            }
            stopAllTimers();
            setIsPolling(false);
            setIsLoading(false);
            setConnectingToExisting(false);
            setLoadingStatus('');
            setCurrentStatusData(null);
            setError('Preview is taking longer than expected (12 minute timeout). Try Refresh first, if it still fails, please contact support.');
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
            const hubStatusUrl = hubStatusUrlRef.current;
            if (hubStatusUrl) {
              // Poll the hub status endpoint directly once we have a viewer token.
              try {
                statusResponse = await fetch(hubStatusUrl, { method: 'GET', cache: 'no-store', credentials: 'omit' });
              } catch (err) {
                // If the browser blocks this (CORS) or network fails, fall back to our API proxy.
                console.warn('[WebContainerRunner] Hub status poll failed; falling back to /api/webcontainer-status', err);
                hubStatusUrlRef.current = null;
                statusResponse = null;
              }
            } else {
              // Fallback: poll via our API until the backend returns a URL with viewer token.
              const headers = await getAuthenticatedHeaders();
              statusResponse = await fetch(`/api/webcontainer-status?code=${code}&appId=${appId}`, {
                headers,
                credentials: "include",
                cache: 'no-store',
              });
            }

            if (!statusResponse) {
              const headers = await getAuthenticatedHeaders();
              statusResponse = await fetch(`/api/webcontainer-status?code=${code}&appId=${appId}`, {
                headers,
                credentials: "include",
                cache: 'no-store',
              });
            }

            if (!statusResponse.ok) {
              // Handle 404s specially for newly created containers
              if (statusResponse.status === 404) {
                containerNotFoundCountRef.current += 1;
                console.log(`Container not found (404) - attempt ${containerNotFoundCountRef.current}/${maxContainerNotFound}`);

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

                if (containerNotFoundCountRef.current >= maxContainerNotFound) {
                  console.log('Too many 404s, giving up on this container');
                  setIsPolling(false);
                  setIsLoading(false);
                  setConnectingToExisting(false);
                  setError('Container failed to start. Refresh first to retry this preview. If it still fails, use Rebuild to start a new machine.');
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

            // Store the status data for UI display
            setCurrentStatusData(statusData);

            const status = String((statusData as any)?.status || '').toLowerCase();
            const uiStage = String((statusData as any)?.uiStage || '').toLowerCase();
            const readyFlag = Boolean((statusData as any)?.ready);
            const deploymentUrlRaw = String((statusData as any)?.url || '').trim();
            const deploymentUrl = deploymentUrlRaw ? normalizePreviewUrlHost(deploymentUrlRaw) : '';
            const appServerKindRaw = String((statusData as any)?.appServerKind || '').toLowerCase();
            const appServerKind = (appServerKindRaw === 'fallback' || appServerKindRaw === 'next-dev' || appServerKindRaw === 'next-prod')
              ? (appServerKindRaw as any)
              : '';

            lastAppServerKindRef.current = appServerKind;

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
              latestDeploymentUrlRef.current = deploymentUrl;
              if (!isValidPreviewUrlCandidate(deploymentUrl)) {
                console.warn('[WebContainerRunner] Ignoring invalid preview url from status (missing /preview/<code>?)', {
                  appId,
                  code,
                  deploymentUrl,
                });
              } else if (status !== 'error' && previewUrlRef.current !== deploymentUrl) {
                // For non-error states, it is useful to show the preview URL ASAP.
                // For error states, only navigate after a successful probe (otherwise we can embed a 404 page).
                iframeLoadedSuccessfullyRef.current = false;
                setPreviewUrl(deploymentUrl);
              }

              // Once we have the viewer token, switch polling to the hub status endpoint.
              const nextHub = buildHubStatusUrl(code, deploymentUrl);
              if (nextHub) hubStatusUrlRef.current = nextHub;
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
              setError('Preview stopped. Try Refresh first, if it still fails, please contact support.');
              setCanRetry(true);
              setPreviewUrl(null);
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

              lastReadyUrlRef.current = readyUrl || null;

              if (!readyUrl) {
                console.error('Backend reported ready but no URL provided:', statusData);
                throw new Error('Backend reported app ready but did not provide deployment URL');
              }

              if (!isValidPreviewUrlCandidate(readyUrl)) {
                console.warn('[WebContainerRunner] Backend ready URL is not a valid preview URL; refusing to navigate', {
                  appId,
                  code,
                  readyUrl,
                });
              }

              // If the parent wants to run its own "Refresh" behavior, notify it once.
              // This is intentionally the AppBuilderEditor "Refresh" (reconnect) semantics.
              if (readyUrl && typeof onBackendReady === 'function') {
                const key = `${code}|${readyUrl}`;
                if (lastBackendReadyNotifyRef.current !== key) {
                  lastBackendReadyNotifyRef.current = key;
                  try {
                    onBackendReady({ appId, code, url: readyUrl });
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
                  proxyBaseRef.current = readyUrl;
                  setPreviewUrl(withCacheBust(readyUrl));
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
                    setPreviewUrl(deploymentUrl);
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
                    setPreviewUrl(deploymentUrl);
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

              // IMPORTANT:
              // If backend reports status=error, do NOT keep retrying and showing "Still building".
              // Stop polling and show the actual error, with a clear next action.
              const reqId = typeof flyApi?.requestId === 'string' ? flyApi.requestId : '';
              const userFacing = buildUserFacingPreviewError({
                uiTitle: statusData?.uiTitle,
                uiMessage: statusData?.uiMessage,
                errorMessage,
                reqId,
                flyIsDischargeMissing,
              });

              console.error('Backend reported error status:', { errorMessage, statusData, flyApi });

              // This preview won't become ready; clear the stored code so we don't loop.
              await clearStoredContainerCodeEverywhere(appId, user);
              stopAllTimers();

              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setLoadingStatus('');
              setError(userFacing);
              setCanRetry(true);
              setCurrentStatusData(null);
              setPreviewUrl(null);
              // Keep the status data available for the inline status component if needed.
              // (Error banner uses `error` above.)
              return;

            } else if (status === 'ready' && !readyFlag) {
              // Some backend flows emit status='ready' before flipping the authoritative ready=true flag.
              // This is expected; keep polling, and avoid showing an 'unknown status' warning.
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
              return;

            } else if (status === 'pending' || status === 'archiving' ||
              status === 'uploading_archive' || status === 'creating_machine' ||
              status === 'booting' || status === 'building' ||
              status === 'compiling' || status === 'starting' ||
              status === 'transitioning') {
              // Still building, continue polling and show progress if available
              // If we have a URL, we already surfaced it above so the iframe can show its own loader.

              if (statusData.uiTitle && statusData.uiMessage) {
                // Use the rich progress information from backend
                // Don't set loadingStatus since it's not displayed during polling
                // setLoadingStatus(`${statusData.uiTitle}: ${statusData.uiMessage}`);
              } else {
                // Fallback to generic message - only set if no rich progress data
                setLoadingStatus('Building app... (this may take several minutes)');
              }
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);

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
              const timeoutReportKey = `retry-timeout:${appId}:${code}`;
              if (lastTimeoutReportKeyRef.current !== timeoutReportKey) {
                lastTimeoutReportKeyRef.current = timeoutReportKey;
                void reportPreviewTimeout({
                  appId,
                  code,
                  status: 'poll_retries_exhausted',
                  message: 'Preview status polling retries were exhausted before readiness.',
                  ageMs: pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : undefined,
                  previewUrl: previewUrlRef.current,
                });
              }
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setCurrentStatusData(null); // Clear status data
              setLoadingStatus(''); // Clear loading status on timeout
              setError('Build is taking longer than expected. The app may still be starting up. Try Refresh first, if it still fails, please contact support.');
              setCanRetry(true);
              setPreviewUrl(null);
              stopAllTimers();
              return; // Don't throw, just return to avoid getting stuck
            } else {
              // Retry polling
              console.log(`Polling retry ${pollingRetryCountRef.current}/${maxPollingRetries}`);
              setLoadingStatus(`Retrying status check... (${pollingRetryCountRef.current}/${maxPollingRetries})`);
              statusPollTimeoutRef.current = setTimeout(pollStatus, POLL_INTERVAL_MS);
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

        const isRetryable = (isNetworkError || isServerError || isTimeout || isProxyError || isBuildError) && !isDiskSpaceError && !isPreconditionError;

        console.log(`Error classification: Network=${isNetworkError}, Server=${isServerError}, Timeout=${isTimeout}, Proxy=${isProxyError}, Build=${isBuildError}, DiskSpace=${isDiskSpaceError}, Precondition=${isPreconditionError}, Retryable=${isRetryable}`);

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

      // Clear any pending automatic retry timeout
      if (automaticRetryTimeoutRef.current) {
        clearTimeout(automaticRetryTimeoutRef.current);
        automaticRetryTimeoutRef.current = null;
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
              : '/api/webcontainer';
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
  }, [appId, startAttempt, restartToken, reconnectToken, forceFreshStart]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const delayMs = 3000;
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
      return;
    }

    if (!previewUrl) {
      // Clear any existing timeout
      if (iframeLoadTimeoutRef.current) {
        clearTimeout(iframeLoadTimeoutRef.current);
        iframeLoadTimeoutRef.current = null;
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

    // Set a timeout for iframe loading (30 seconds for DNS/network issues)
    if (!isSoftReload) {
      iframeLoadTimeoutRef.current = setTimeout(() => {
        if (!iframeLoadedSuccessfullyRef.current) {
          console.log('Iframe load timeout - URL may be unreachable:', previewUrl);
          // If backend hasn't declared ready yet, treat iframe reachability as transient.
          // Keep polling so we can recover from restarts/DNS delays.
          if (!backendReadyRef.current) {
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
                  uiMessage: prev?.uiMessage || 'Preview is still loading in the embedded frame. If it stays stuck, use “Open in new tab” or “Reload preview”.',
                  updatedAt: Date.now(),
                }
                : {
                  uiStage: 'waiting_for_preview',
                  uiTitle: 'Starting preview',
                  uiMessage: 'Preview is still loading in the embedded frame. If it stays stuck, use “Open in new tab” or “Reload preview”.',
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
            setError('Preview couldn’t load in this iframe because the required routing cookie appears blocked. Necessary cookies are required for app building and connecting this preview. We will automatically restart the preview in a few seconds.');
            setCookieRecoveryPromptVisible(true);
            setCanRetry(true);
            reportCookieIframeBlocked({
              previewUrl,
              reason: 'iframe_load_timeout_cookie_likely',
              message: 'Preview couldn’t load in iframe due to likely routing-cookie block.',
            });
            scheduleAutomaticPreviewRestart('iframe_load_timeout_cookie_likely', 6000);
          } else {
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
      }, 30000); // 30 second timeout
    }

    return () => {
      if (iframeLoadTimeoutRef.current) {
        clearTimeout(iframeLoadTimeoutRef.current);
        iframeLoadTimeoutRef.current = null;
      }
    };
  }, [previewUrl, onPreviewReadyChange, externalPreviewMode]);

  const previewStatus = String((currentStatusData as any)?.status || '').toLowerCase();
  const previewInteractiveByStatus = [
    'ready',
    'running',
    'compiled',
    'started',
    'completed',
    'finished',
    'active',
    'online',
  ].includes(previewStatus);
  const previewUrlAgeMs = previewUrlFirstSeenAtRef.current > 0 ? Date.now() - previewUrlFirstSeenAtRef.current : 0;
  const loadingLower = String(loadingStatus || '').toLowerCase();
  const stuckConnectingWithUrl =
    Boolean(previewUrl) &&
    isPolling &&
    !externalPreviewMode &&
    !backendReadyRef.current &&
    !previewInteractiveByStatus &&
    (connectingToExisting || loadingLower.includes('connecting to machine')) &&
    previewUrlAgeMs > 45_000;

  const canRenderEmbeddedFrame =
    backendReadyRef.current ||
    hmrWsStatus === 'ok' ||
    previewInteractiveByStatus ||
    stuckConnectingWithUrl;
  const showPreviewSurface = Boolean(previewUrl) && !error && !compileErrorState && (externalPreviewMode || canRenderEmbeddedFrame);
  const activePreviewUrl = previewUrl || '';
  const showApplyRefreshingOverlay = showPreviewSurface && isApplyRefreshing;

  return (
    <div className="h-full flex flex-col bg-white text-black/90 border border-black/10 rounded-2xl shadow">
      {error && (
        <div className="p-4 border-b border-black/10">
          <div className="space-y-3">
            <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>
            {canRetry && (
              (() => {
                const normalized = String(error || '').toLowerCase();
                const cookieRelated = cookieRecoveryPromptVisible || looksLikeCookieIframeIssue(normalized);

                return (
              <div className="space-y-2">
              {cookieRelated ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Your browser privacy settings may block embedded preview routing. Use Refresh to retry, or open the preview in a separate tab for the most reliable connection.
                </div>
              ) : null}
              <button
                onClick={retryApp}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs bg-accent text-white hover:bg-[#e54f1a] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              {cookieRelated ? (
                <button
                  onClick={retryApp}
                  className="inline-flex ml-2 items-center gap-2 px-4 py-2 rounded-full text-xs border border-amber-300 bg-white text-amber-900 hover:bg-amber-50 transition-colors"
                >
                  Restart preview now
                </button>
              ) : null}
              </div>
                );
              })()
            )}
          </div>
        </div>
      )}
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
                {compileErrorState.canShowFreeFixCta ? (
                  <button
                    type="button"
                    onClick={() => {
                      emitCompileErrorTelemetry('compile_error_fix_clicked', {
                        code: compileErrorState.code,
                        fingerprint: compileErrorState.fingerprint,
                        actionType: compileErrorState.actionType,
                        fixAction: compileErrorState.fixAction || null,
                      });
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
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs bg-accent text-white hover:bg-[#e54f1a] transition-colors"
                  >
                    Fix with AI
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={retryApp}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs border border-black/15 bg-white text-black/80 hover:bg-black/5 transition-colors"
                >
                  Refresh
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
            key={iframeKey}
            src={activePreviewUrl}
            className="w-full h-full border border-black/10 rounded-lg"
            title="App Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => {
              console.log('[WebContainerRunner] iframe onLoad (navigation complete):', previewUrl);

              clearSafariEmbedFailure(activePreviewUrl);

              if (iframePostLoadTimeoutRef.current) {
                clearTimeout(iframePostLoadTimeoutRef.current);
                iframePostLoadTimeoutRef.current = null;
              }

              // Iframe load can be a real app OR a "Not Found"/fallback page.
              // Only declare the preview "ready" when the backend contract says `ready === true`.
              iframeLoadedSuccessfullyRef.current = true;
              appLoadedSuccessfullyRef.current = true;

              const status = String((currentStatusData as any)?.status || '').toLowerCase();
              const uiReadyByStatus = [
                'ready',
                'running',
                'compiled',
                'started',
                'completed',
                'finished',
                'active',
                'online',
              ].includes(status);

              // For the chat UX we want to unlock when the preview is actually usable.
              // Backend `ready === true` is ideal, but it can lag; HMR websocket `ok`
              // and strong non-error statuses are good enough to treat as interactive.
              const uiReady = backendReadyRef.current || hmrWsStatus === 'ok' || uiReadyByStatus;

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
                setError('Preview couldn’t load in this iframe because the required routing cookie appears blocked or not ready yet. Necessary cookies are required for app building and connecting this preview. We will automatically restart the preview in a few seconds.');
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
              } else if (activePreviewUrl.includes('.fly.dev') || activePreviewUrl.includes('localhost')) {
                setError(`Unable to connect to ${activePreviewUrl}. The deployment may still be starting up or has failed. Please try again in a few minutes.`);
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
              } else {
                setCookieRecoveryPromptVisible(false);
                handleAssetFailure();
              }
            }}
          />
          )}
        </div>
      ) : !error && !compileErrorState ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            {isPolling ? (
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
                        uiMessage: 'This may take several minutes for first-time builds',
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
              </div>
            ) : (
              // Initial loading state
              <>
                <div className="kloner-dots" aria-hidden="true"><span className="kloner-dot" /><span className="kloner-dot" /><span className="kloner-dot" /></div>
                {renderLiveStatusLine({
                  uiStage: connectingToExisting ? 'reconnecting' : 'starting_app',
                  uiTitle: connectingToExisting ? 'Connecting to existing machine' : 'Starting your app',
                  uiMessage: connectingToExisting ? 'Reconnecting to your saved session' : 'Setting up your development environment',
                  updatedAt: Date.now(),
                })}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}