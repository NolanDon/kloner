// components/WebContainerRunner.tsx
"use client";

import { useEffect, useRef, useState } from 'react';
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
  reloadToken?: number;
  restartToken?: number;
  reconnectToken?: number;
  forceFreshStart?: number;
  pollingConfig?: {
    // Default is the existing behavior (30 retries, ~5 minutes).
    // Use this only for long-running generated builds.
    maxPollingRetries?: number;
    maxContainerNotFound?: number;
  };
  navigatePath?: string | null;
  navigatePathToken?: number;
}

export default function WebContainerRunner({ appId, files, onFileChange, onPreviewReadyChange, reloadToken, restartToken, reconnectToken, forceFreshStart, pollingConfig, navigatePath, navigatePathToken }: WebContainerRunnerProps) {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [startAttempt, setStartAttempt] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [currentStatusData, setCurrentStatusData] = useState<any>(null); // Store latest status data for UI
  const [connectingToExisting, setConnectingToExisting] = useState(false); // Track if connecting to existing machine
  // Prevent duplicate starts for the *same* set of inputs. This avoids the
  // original "start/stop" thrash bug while still allowing reconnect/retry tokens.
  const lastStartKeyRef = useRef<string | null>(null);
  const maxRetries = 2; // Reduced from 3 to be less aggressive
  const maxPollingRetries =
    typeof pollingConfig?.maxPollingRetries === 'number'
      ? pollingConfig.maxPollingRetries
      : 30; // default: up to ~5 minutes of polling
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
  const automaticRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track automatic retry timeout

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

  const probePreviewUrl = async (appId: string, url: string): Promise<boolean> => {
    const attempts = 2;
    for (let i = 0; i < attempts; i++) {
      try {
        const headers = await getAuthenticatedHeaders();
        const res = await fetch(
          `/api/webcontainer-probe?appId=${encodeURIComponent(appId)}&url=${encodeURIComponent(url)}`,
          { method: 'GET', headers, credentials: 'include', cache: 'no-store' }
        );
        const data = await res.json().catch(() => null);
        if (res.ok && (data as any)?.ok && (data as any)?.reachable) return true;
      } catch {
        // ignore; retry
      }

      // small backoff before retry
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    return false;
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
      if (!res.ok) return { ok: false, reason: "http_error" };
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
    const running = normalized === "started" || normalized === "running" || normalized === "starting";
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
    setIsPolling(false); // Reset polling state
    setPreviewUrl(null);
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
    
    // Do not clear stored container code on retry.
    // Retry should attempt to reconnect to the saved machine first.
  };
  const proxyBaseRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const lastReloadIssuedAtRef = useRef<number>(0);
  const lastReloadTokenRef = useRef<number | null>(null);
  const lastRestartTokenRef = useRef<number | null>(null);
  const lastReconnectTokenRef = useRef<number | null>(null);
  const lastNavigatePathTokenRef = useRef<number | null>(null);
  const lastPreviewUrlForLoadRef = useRef<string | null>(null);
  const reconnectOnlyRef = useRef(false);
  const filesRef = useRef(files);
  const startRunIdRef = useRef(0);
  const effectStartedAtRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ensuredConfigRef = useRef(false);

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
    // const stage = String(statusData?.uiStage || statusData?.status || '').trim();
    const title = String(statusData?.uiTitle || '').trim();
    const detail = String(statusData?.uiMessage || '').trim();
    // UI log line contract:
    // - Show exactly one message (prefer uiMessage).
    // - Format: HH:MM — <message>
    const message = detail || title;
    const updatedAtMs = getUpdatedAtMs(statusData?.updatedAt);
    const timeLabel = typeof updatedAtMs === 'number' ? formatStatusTime(updatedAtMs) : '';
    // if (!stage && !message && !timeLabel) return null;
    if (!message) return null;

    const left = timeLabel;
    return (
      <div className="mt-6 w-full max-w-2xl rounded-2xl border border-black/10 bg-white/70 px-6 py-4 text-left shadow-sm backdrop-blur-sm">
        <div className="text-sm text-black/80">
          {left ? <span className="font-semibold">{left}</span> : null}
          <span className="text-black/60">{`${left ? ' — ' : ''}${message}`}</span>
        </div>
      </div>
    );
  };

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  const withCacheBust = (url: string) => {
    const cb = String(Date.now());
    try {
      const u = new URL(url);
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
      const u = new URL(previewUrl);
      // IMPORTANT: keep `t` (viewer token). Only strip our cache-buster.
      u.searchParams.delete('cb');
      proxyBaseRef.current = u.toString();
    } catch {
      proxyBaseRef.current = String(previewUrl).split('?')[0] || previewUrl;
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
        setIsPolling(false); // Reset polling state
        setPreviewUrl(null);
        setConnectingToExisting(false);
        pollingRetryCountRef.current = 0; // Reset retry count
        containerNotFoundCountRef.current = 0; // Reset 404 counter

        console.log('Starting app with ID:', appId);

  const reconnectOnly = reconnectOnlyRef.current;
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
          console.log(`🔌 Reconnect requested but no stored container code found for app ${appId}`);
          setConnectingToExisting(false);
          setIsLoading(false);
          setIsPolling(false);
          setError('No saved machine found to reconnect.');
          setCanRetry(true);
          return;
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

                  const reachable = await probePreviewUrl(appId, statusData.url);
                  if (reachable) {
                    pollingCodeRef.current = existingCode;
                    setPreviewUrl(statusData.url);
                    setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                    setIsLoading(false);
                    appLoadedSuccessfullyRef.current = true;
                    return; // Successfully connected to existing container
                  }

                  console.log(`❌ Probe failed for existing container ${existingCode}; clearing stored code and creating a new machine.`);
                  if (reconnectOnly) {
                    setConnectingToExisting(false);
                    setIsLoading(false);
                    setIsPolling(false);
                    setError('Could not reach the existing machine. Try Reconnect again, or use Start fresh.');
                    setCanRetry(true);
                    return;
                  }
                  await clearStoredContainerCodeEverywhere(appId, user);
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
                      const flySaysRunning =
                        normalized === "started" ||
                        normalized === "running" ||
                        normalized === "starting";
                      if (flySaysRunning) {
                        console.log(
                          `✅ Fly reports machine ${statusData.machineId} is '${flyState.state}', probing URL before reusing stopped container ${existingCode}`
                        );
                        const reachable = await probePreviewUrl(appId, statusData.url);
                        if (reachable) {
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

                const reachable = await probePreviewUrl(appId, statusData.url);
                if (reachable) {
                  console.log(`✅ Probe succeeded for container ${existingCode} (${statusData.machineId})`);
                  pollingCodeRef.current = existingCode;
                  setPreviewUrl(statusData.url);
                  setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                  setIsLoading(false);
                  appLoadedSuccessfullyRef.current = true;
                  return;
                }

                console.log(`❌ Probe failed for container ${existingCode}; clearing stored code.`);
                if (reconnectOnly) {
                  setConnectingToExisting(false);
                  setIsLoading(false);
                  setIsPolling(false);
                  setError('Could not reach the existing machine. Try Reconnect again, or use Start fresh.');
                  setCanRetry(true);
                  return;
                }
                await clearStoredContainerCodeEverywhere(appId, user);
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
              // Treat 5xx as transient backend/hub issues. Do NOT clear stored code
              // or create a new machine; instead, keep listening until status recovers.
              console.log(
                `⚠️ Status service error for container ${existingCode}: ${statusResponse.status} ${statusResponse.statusText}. Entering polling mode instead of creating a new machine.`
              );

              setIsLoading(false);
              setIsPolling(true);
              setConnectingToExisting(true);
              setError(null);
              setCanRetry(false);
              setCurrentStatusData(null);
              setLoadingStatus('');

              const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

              const startedAt = Date.now();
              let attempt = 0;
              while (startRunIdRef.current === runId && Date.now() - startedAt < 360000) {
                attempt += 1;
                try {
                  const headers = await getAuthenticatedHeaders();
                  const res = await fetch(
                    `/api/webcontainer-status?code=${encodeURIComponent(existingCode)}&appId=${encodeURIComponent(appId)}`,
                    { method: 'GET', headers, credentials: 'include', cache: 'no-store' }
                  );

                  if (startRunIdRef.current !== runId) return;

                  if (res.status === 404 || res.status === 409) {
                    const data = await res.json().catch(() => ({} as any));
                    setIsPolling(false);
                    setConnectingToExisting(false);
                    setIsLoading(false);
                    setError(String((data as any)?.error || 'Preview expired.'));
                    setCanRetry(true);
                    // code is invalid/expired; allow normal flow to create a new machine
                    await clearStoredContainerCodeEverywhere(appId, user);
                    break;
                  }

                  if (res.ok) {
                    const statusData = await res.json().catch(() => ({} as any));
                    setCurrentStatusData(statusData);

                    const status = String((statusData as any)?.status || '').toLowerCase();
                    const isReady =
                      status === 'ready' ||
                      ['running', 'compiled', 'started', 'online', 'active', 'completed', 'finished'].includes(status);
                    const url = String((statusData as any)?.url || '').trim();

                    if (url && isReady) {
                      const reachable = await probePreviewUrl(appId, url);
                      if (startRunIdRef.current !== runId) return;
                      if (reachable) {
                        pollingCodeRef.current = existingCode;
                        iframeLoadedSuccessfullyRef.current = false;
                        setPreviewUrl(url);
                        setIsPolling(false);
                        setConnectingToExisting(false);
                        setIsLoading(false);
                        setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                        appLoadedSuccessfullyRef.current = true;
                        return;
                      }
                    }
                  }
                } catch {
                  // ignore transient errors; keep polling
                }

                const waitMs = Math.min(5000, 900 + attempt * 250);
                await sleep(waitMs);
              }

              if (startRunIdRef.current !== runId) return;
              // If we didn't connect, stop polling and show a neutral error.
              setIsPolling(false);
              setConnectingToExisting(false);
              setIsLoading(false);
              setError('Temporary backend issue while checking your saved machine. Please wait a moment and try Reconnect again.');
              setCanRetry(false);
              return;
            } else {
              console.log(`❌ Failed to get status for container ${existingCode}: ${statusResponse.status} ${statusResponse.statusText}`);
            }
          } catch (err) {
            console.log(`❌ Failed to check status of existing container ${existingCode}, will create new one:`, err);
            if (reconnectOnly) {
              setConnectingToExisting(false);
              setIsLoading(false);
              setIsPolling(false);
              setError('Failed to reconnect to the existing machine. Try Reconnect again, or use Start fresh.');
              setCanRetry(true);
              return;
            }
            // Clear the stored code since it's not usable
            await clearStoredContainerCodeEverywhere(appId, user);
          }

          // If we get here, the existing container is not usable
          console.log(`🆕 No usable existing container found for app ${appId}, creating new one`);
          if (reconnectOnly) {
            setConnectingToExisting(false);
            setIsLoading(false);
            setIsPolling(false);
            setError('No usable existing machine to reconnect to. Use Start fresh to create a new one.');
            setCanRetry(true);
            return;
          }
          setConnectingToExisting(false);
          await clearStoredContainerCodeEverywhere(appId, user);
        } else {
          console.log(`ℹ️ No stored container code found for app ${appId}, creating new one`);
        }
        } // End of forceFreshStart else block

        if (reconnectOnly) {
          // Reconnect-only should never fall through into "create new container".
          setConnectingToExisting(false);
          setIsLoading(false);
          setIsPolling(false);
          setError('Reconnect only: unable to reach an existing machine.');
          setCanRetry(true);
          return;
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

        let response = await postWebcontainer(0);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as any));
          const errorMsg = String(errorData?.error || 'Failed to start app');

          // CSRF can drift (cookie/header mismatch). Refresh token and retry once.
          if (response.status === 403 && errorMsg.toLowerCase().includes('csrf')) {
            console.warn('Webcontainer start hit CSRF 403; retrying once with fresh CSRF token');
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

          try {
            const headers = await getAuthenticatedHeaders();
            const statusResponse = await fetch(`/api/webcontainer-status?code=${code}&appId=${appId}`, {
              headers,
              credentials: "include"
            });
            if (!statusResponse.ok) {
              // Handle 404s specially for newly created containers
              if (statusResponse.status === 404) {
                containerNotFoundCountRef.current += 1;
                console.log(`Container not found (404) - attempt ${containerNotFoundCountRef.current}/${maxContainerNotFound}`);

                // Provide a helpful UI status while waiting for the backend to register the preview.
                // (404 during the first ~seconds is expected; do not treat as fatal yet.)
                setCurrentStatusData({
                  uiStage: 'registering_preview',
                  uiTitle: 'Starting preview',
                  uiMessage: 'Waiting for the preview to come online…',
                  updatedAt: Date.now(),
                  status: 'starting',
                  uiProgress: 0,
                });
                
                if (containerNotFoundCountRef.current >= maxContainerNotFound) {
                  console.log('Too many 404s, giving up on this container');
                  setIsPolling(false);
                  setIsLoading(false);
                  setConnectingToExisting(false);
                  setError('Container failed to start. The deployment may have failed.');
                  setCanRetry(true);
                  setLoadingStatus('');
                  setCurrentStatusData(null);
                  setPreviewUrl(null);
                  // Clear the stored code since it's not working
                  await clearStoredContainerCodeEverywhere(appId, user);
                  return;
                }
                
                // For 404s, retry more frequently since the container might not be registered yet
                statusPollTimeoutRef.current = setTimeout(pollStatus, 2000); // Retry in 2 seconds
                return;
              }
              throw new Error(`Status check failed: ${statusResponse.status}`);
            }

            const statusData = await statusResponse.json();
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
            const deploymentUrl = String((statusData as any)?.url || '').trim();

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
              setError('Preview stopped. Use Reconnect, or Start fresh to create a new machine.');
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
              if (deploymentUrl) {
                // Show the host UI if it's up, but keep polling until ready.
                iframeLoadedSuccessfullyRef.current = false;
                setPreviewUrl(deploymentUrl);
              }
              statusPollTimeoutRef.current = setTimeout(pollStatus, 5000);
              return;
            }

            const isReady =
              readyFlag ||
              status === 'ready' ||
              ['running', 'compiled', 'started', 'online', 'active', 'completed', 'finished'].includes(status);

            if (isReady) {
              backendReadyRef.current = true;
              console.log('Deployment ready at:', deploymentUrl);

              if (!deploymentUrl) {
                console.error('Backend reported ready but no URL provided:', statusData);
                throw new Error('Backend reported app ready but did not provide deployment URL');
              }

              // Clear status data since we're done
              setCurrentStatusData(null);
              setLoadingStatus('');

              // Force a reload when we hit ready, so we don't stick on a fallback UI.
              const readyUrl = withCacheBust(deploymentUrl);

              // For Fly.io deployments, add a small delay to let DNS propagate
              if (deploymentUrl.includes('.fly.dev')) {
                console.log('Fly.io deployment detected, allowing time for DNS propagation...');
                setLoadingStatus(`Deployment ready on machine ${(statusData as any)?.machineId}! Waiting for DNS propagation...`);
                setTimeout(() => {
                  setPreviewUrl(readyUrl);
                  setLoadingStatus(`Connected to machine ${(statusData as any)?.machineId}! Loading interface...`);
                  setIsPolling(false);
                  appLoadedSuccessfullyRef.current = true;
                  pollingRetryCountRef.current = 0;
                  if (retryTimeoutRef.current) {
                    clearTimeout(retryTimeoutRef.current);
                    retryTimeoutRef.current = null;
                  }
                }, 10000);
              } else {
                setPreviewUrl(readyUrl);
                setLoadingStatus(`Connected to machine ${(statusData as any)?.machineId}! Loading interface...`);
                setIsPolling(false);
                appLoadedSuccessfullyRef.current = true;
                pollingRetryCountRef.current = 0;
                if (retryTimeoutRef.current) {
                  clearTimeout(retryTimeoutRef.current);
                  retryTimeoutRef.current = null;
                }
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
                  const reachable = await probePreviewUrl(appId, deploymentUrl);
                  if (reachable) {
                    console.log('Direct probe successful, proceeding with URL:', deploymentUrl);
                    iframeLoadedSuccessfullyRef.current = false;
                    setPreviewUrl(deploymentUrl);
                    setLoadingStatus('Preview is reachable. Still verifying readiness…');
                    setIsPolling(true);
                    setError(null);
                    setCanRetry(false);
                    appLoadedSuccessfullyRef.current = true;
                    pollingRetryCountRef.current = 0;
                    statusPollTimeoutRef.current = setTimeout(pollStatus, 5000);
                    return;
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
                  const reachable = await probePreviewUrl(appId, deploymentUrl);
                  if (reachable) {
                    console.log('Preview URL is reachable despite error status; proceeding with URL:', deploymentUrl);
                    iframeLoadedSuccessfullyRef.current = false;
                    setPreviewUrl(deploymentUrl);
                    setLoadingStatus('Preview is reachable. Still verifying readiness…');
                    setIsPolling(true);
                    setError(null);
                    setCanRetry(false);
                    appLoadedSuccessfullyRef.current = true;
                    pollingRetryCountRef.current = 0;
                    statusPollTimeoutRef.current = setTimeout(pollStatus, 5000);
                    return;
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

                setCurrentStatusData({
                  ...statusData,
                  status: 'booting',
                  uiStage: 'booting',
                  uiTitle: 'Starting preview',
                  uiMessage: `Preview hit a transient boot error and is restarting. Still trying for ~${Math.ceil(remainingMs / 1000)}s…`,
                  uiProgress: typeof statusData?.uiProgress === 'number' ? statusData.uiProgress : 0,
                });

                setLoadingStatus('Preview is still starting (this can take a few minutes)…');

                // Continue polling a bit faster during grace.
                statusPollTimeoutRef.current = setTimeout(pollStatus, 5000);
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
              const uiTitle = String(statusData?.uiTitle || 'Something went wrong').trim();
              const uiMsg = String(statusData?.uiMessage || '').trim();
              const reqId = typeof flyApi?.requestId === 'string' ? flyApi.requestId : '';

              let userFacing = [uiTitle, uiMsg].filter(Boolean).join(' — ');

              // If the backend only provides a generic UI message, also include the underlying error details.
              // This is especially important when the machine boot script fails (exit code) or a healthcheck/port mismatch occurs.
              const isGenericUi =
                uiTitle.toLowerCase() === 'something went wrong' ||
                uiMsg.toLowerCase().includes("couldn’t get your preview ready") ||
                uiMsg.toLowerCase().includes("couldn't get your preview ready") ||
                uiMsg.toLowerCase().includes('could not start the preview');

              if (!userFacing) userFacing = errorMessage;
              else if (isGenericUi && errorMessage && !userFacing.toLowerCase().includes(String(errorMessage).toLowerCase())) {
                userFacing = `${userFacing}\n\nDetails: ${errorMessage}`;
              }

              if (flyIsDischargeMissing) {
                userFacing =
                  "Fly Machines API rejected the token used by the hub (tracksite-hub). The FlyV1 token is missing its third-party discharge token (likely split/truncated).\n\nFix: update the Fly app 'tracksite-hub' secret so FLY_API_TOKEN is a single full token: 'FlyV1 <macaroon>,<discharge>' (do not split on commas). Then restart/redeploy the hub and try again." +
                  (reqId ? `\n\nFly requestId: ${reqId}` : '');
              }

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

            } else if (status === 'pending' || status === 'archiving' || 
                       status === 'uploading_archive' || status === 'creating_machine' || 
                       status === 'booting' || status === 'building' || 
                       status === 'compiling' || status === 'starting') {
              // Still building, continue polling and show progress if available
              // But if we have a URL and the machine is running (not just pending/creating), try to connect early
              if (deploymentUrl && !['pending', 'archiving', 'uploading_archive', 'creating_machine'].includes(status)) {
                console.log(`Backend reports ${status} but has URL, checking reachability:`, deploymentUrl);
                try {
                  const reachable = await probePreviewUrl(appId, deploymentUrl);
                  if (reachable) {
                    console.log('URL is reachable during build; showing preview while continuing to poll');
                    iframeLoadedSuccessfullyRef.current = false;
                    setPreviewUrl(deploymentUrl);
                    setLoadingStatus(`Connecting to machine ${(statusData as any)?.machineId}... (showing progress)`);
                    setIsPolling(true);
                    setError(null);
                    setCanRetry(false);
                    appLoadedSuccessfullyRef.current = true;
                    pollingRetryCountRef.current = 0;
                    statusPollTimeoutRef.current = setTimeout(pollStatus, 10000);
                    return;
                  }
                  console.log('URL not yet reachable, continuing to poll');
                } catch {
                  // Not reachable yet, continuing to poll
                  console.log('URL not yet reachable, continuing to poll');
                }
              }
              
              if (statusData.uiTitle && statusData.uiMessage) {
                // Use the rich progress information from backend
                // Don't set loadingStatus since it's not displayed during polling
                // setLoadingStatus(`${statusData.uiTitle}: ${statusData.uiMessage}`);
              } else {
                // Fallback to generic message - only set if no rich progress data
                setLoadingStatus('Building app... (this may take several minutes)');
              }
              statusPollTimeoutRef.current = setTimeout(pollStatus, 10000); // Poll every 10 seconds

            } else {
              // Unknown status - log it and treat as still building for now
              console.warn('Unknown status received from backend:', statusData.status, statusData);
              setLoadingStatus(`Building app... (status: ${status})`);
              statusPollTimeoutRef.current = setTimeout(pollStatus, 10000); // Poll every 10 seconds
            }

          } catch (err) {
            console.error('Status polling error:', err);
            
            // Handle specific backend errors that shouldn't be shown to users
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            if (errorMessage.includes('Element at index 0 is not a valid array element') ||
                errorMessage.includes('FieldValue.serverTimestamp() cannot be used inside of an array')) {
              console.error('Backend Firestore error detected - this is a server-side issue that should be fixed');
              // Don't count this as a polling retry, just try again
              statusPollTimeoutRef.current = setTimeout(pollStatus, 3000); // Retry after 3 seconds
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
              setIsPolling(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setCurrentStatusData(null); // Clear status data
              setLoadingStatus(''); // Clear loading status on timeout
              setError('Build is taking longer than expected. The app may still be starting up. Try Reconnect, or use Start fresh to start a new machine.');
              setCanRetry(true);
              setPreviewUrl(null);
              stopAllTimers();
              return; // Don't throw, just return to avoid getting stuck
            } else {
              // Retry polling
              console.log(`Polling retry ${pollingRetryCountRef.current}/${maxPollingRetries}`);
              setLoadingStatus(`Retrying status check... (${pollingRetryCountRef.current}/${maxPollingRetries})`);
              statusPollTimeoutRef.current = setTimeout(pollStatus, 5000); // Retry after 5 seconds
            }
          }
        };

        // Start the first status poll - wait much longer for Node.js machine to start
        statusPollTimeoutRef.current = setTimeout(pollStatus, 20000); // Start polling after 20 seconds (increased from 15)

      } catch (err) {
        console.error('Error starting app:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
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

  // Handle iframe load timeout
  useEffect(() => {
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
                    uiMessage: prev?.uiMessage || 'Preview URL not reachable yet. Still trying…',
                    updatedAt: Date.now(),
                  }
                : {
                    uiStage: 'waiting_for_preview',
                    uiTitle: 'Starting preview',
                    uiMessage: 'Preview URL not reachable yet. Still trying…',
                    updatedAt: Date.now(),
                    status: 'starting',
                    uiProgress: 0,
                  }
            );
            iframeLoadedSuccessfullyRef.current = false;
            appLoadedSuccessfullyRef.current = true;
            setPreviewUrl(null);
            try { onPreviewReadyChange?.(false); } catch { }
            return;
          }

          // If backend had already declared ready, treat this as a real failure.
          setError(`Unable to load preview at ${previewUrl}. Try Reconnect, or use Start fresh to start a new machine.`);
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
  }, [previewUrl]);

  return (
    <div className="h-full flex flex-col bg-white text-black/90 border border-black/10 rounded-2xl shadow">
      {error && (
        <div className="p-4 border-b border-black/10">
          <div className="space-y-3">
            <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>
            {canRetry && (
              <button
                onClick={retryApp}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs bg-accent text-white rounded-lg hover:bg-[#e54f1a] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Again
              </button>
            )}
          </div>
        </div>
      )}
      {previewUrl && !error ? (
        <div className="relative w-full h-full">
          <iframe
            src={previewUrl}
            className="w-full h-full border border-black/10 rounded-lg"
            title="App Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            onLoad={() => {
              console.log('Iframe loaded successfully - preview should now be active at:', previewUrl);

              // Iframe load indicates the host is reachable (often a fallback UI).
              // Only stop polling and mark "ready" when the backend contract says `ready === true`.
              setError(null);
              setCanRetry(false);
              setIsLoading(false);
              setConnectingToExisting(false);
              setLoadingStatus('');
              iframeLoadedSuccessfullyRef.current = true;
              appLoadedSuccessfullyRef.current = true;

              if (backendReadyRef.current) {
                try { onPreviewReadyChange?.(true); } catch { }
                stopAllTimers();
                if (isPolling) setIsPolling(false);
                if (currentStatusData) setCurrentStatusData(null);
              } else {
                try { onPreviewReadyChange?.(false); } catch { }
                // Keep polling in the background until `ready === true`.
                if (!isPolling) setIsPolling(true);
              }
              // Reset asset failure count on successful load
              assetFailureCountRef.current = 0;
              // Clear the load timeout since we succeeded
              if (iframeLoadTimeoutRef.current) {
                clearTimeout(iframeLoadTimeoutRef.current);
                iframeLoadTimeoutRef.current = null;
              }

              // Add a small delay then try to validate the deployment
              setTimeout(() => {
                console.log('Machined Preview loaded successfully - sticky routing via tsc_preview cookie should be active');
                // For now, just log that the deployment seems to be working
                // CORS prevents us from doing detailed content checks
              }, 2000);
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
                setPreviewUrl(null);
                return;
              }

              // Check if this looks like a DNS/network error or preview routing issue
              if (previewUrl.includes('tracksite-hub.fly.dev')) {
                setError(`Preview failed to load. This may be due to cookie/session issues or the preview not being ready yet. Automatically refreshing in 10 seconds...`);
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
                // Automatically retry after 10 seconds for hub domain errors (only if not already scheduled)
                if (!retryScheduledRef.current && totalAttemptsRef.current < maxTotalAttempts) {
                  retryScheduledRef.current = true;
                  automaticRetryTimeoutRef.current = setTimeout(() => {
                    console.log('Automatically retrying preview load...');
                    retryScheduledRef.current = false;
                    retryApp();
                  }, 10000);
                }
              } else if (previewUrl.includes('.fly.dev') || previewUrl.includes('localhost')) {
                setError(`Unable to connect to ${previewUrl}. The deployment may still be starting up or has failed. Please try again in a few minutes.`);
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
                handleAssetFailure();
              }
            }}
          />
        </div>
      ) : !error ? (
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