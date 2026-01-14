// components/WebContainerRunner.tsx
"use client";

import { useEffect, useRef, useState } from 'react';
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";

// React 18 StrictMode in dev intentionally mounts/unmounts twice.
// If we eagerly stop the local runner on unmount, we create a start/stop/start loop.
// This small scheduler avoids killing the process when a remount happens immediately.
const pendingCleanupTimers = new Map<string, number>();

interface WebContainerRunnerProps {
  appId: string;
  files: { [path: string]: { content: string; lastModified: number } };
  onFileChange?: (path: string, content: string) => void;
  reloadToken?: number;
  restartToken?: number;
}

export default function WebContainerRunner({ appId, files, onFileChange, reloadToken, restartToken }: WebContainerRunnerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startAttempt, setStartAttempt] = useState(0);
  const maxRetries = 3;
  const proxyBaseRef = useRef<string | null>(null);
  const lastReloadTokenRef = useRef<number | null>(null);
  const lastRestartTokenRef = useRef<number | null>(null);
  const filesRef = useRef(files);
  const startRunIdRef = useRef(0);
  const effectStartedAtRef = useRef<number>(0);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    // Cancel any pending cleanup for this appId (e.g. StrictMode remount).
    const pending = pendingCleanupTimers.get(appId);
    if (typeof pending === 'number') {
      clearTimeout(pending);
      pendingCleanupTimers.delete(appId);
    }

    const runId = ++startRunIdRef.current;
    effectStartedAtRef.current = Date.now();

    const startApp = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setPreviewUrl(null);

        console.log('Starting app with ID:', appId);
        console.log('Files:', Object.keys(filesRef.current));

        const proxyUrl = `/api/webcontainer/${appId}/proxy/`;
        proxyBaseRef.current = proxyUrl;

        // If restartToken changed, force a hard restart (stop server + start again).
        const shouldRestart =
          typeof restartToken === 'number' &&
          lastRestartTokenRef.current !== null &&
          lastRestartTokenRef.current !== restartToken;

        if (shouldRestart) {
          try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            await fetch('/api/webcontainer', {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                ...(csrf ? { 'x-csrf': csrf } : {}),
              },
              body: JSON.stringify({ appId }),
            });
          } catch (e) {
            console.log('Restart cleanup failed (continuing):', e);
          }
        }

        if (typeof restartToken === 'number') {
          lastRestartTokenRef.current = restartToken;
        }

        const csrf = await ensureSessionAndCsrf().catch(() => null);
        const response = await fetch('/api/webcontainer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'x-csrf': csrf } : {}),
          },
          body: JSON.stringify({ appId, files: filesRef.current }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to start app');
        }

        const data = await response.json();
        console.log('App started successfully:', data);

        // Poll the proxy endpoint to ensure it's ready.
        // This can legitimately take a while (first compile, cold start, etc).
        const maxAttempts = 120; // ~2-3 minutes total with backoff
        let attempts = 0;
        let proxyReady = false;
        let delayMs = 500;

        while (attempts < maxAttempts && !proxyReady) {
          if (startRunIdRef.current !== runId) return;
          try {
            console.log(`Checking if proxy is ready (attempt ${attempts + 1}/${maxAttempts})...`);
            const proxyCheck = await fetch(proxyUrl, { 
              method: 'HEAD',
              cache: 'no-store',
            });

            // Auth failures won't fix themselves.
            if (proxyCheck.status === 401 || proxyCheck.status === 403) {
              throw new Error('Not authorized to access preview (session/scope).');
            }

            // Consider any 2xx a success.
            if ((proxyCheck.status >= 200 && proxyCheck.status < 300) || proxyCheck.ok) {
              proxyReady = true;
              console.log('Proxy is ready!');
              break;
            } else {
              console.log(`Proxy not ready yet, status: ${proxyCheck.status}`);
            }
          } catch (err) {
            console.log('Proxy check failed:', err);
          }

          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs = Math.min(2000, Math.floor(delayMs * 1.25));
          attempts++;
        }

        if (!proxyReady) {
          throw new Error('Proxy endpoint did not become ready in time');
        }
        
        // Use same-origin proxy to satisfy COEP/CORP and cookies on HTTPS
        setPreviewUrl(proxyUrl);
      } catch (err) {
        console.error('Error starting app:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        
        // Retry logic for transient failures
        if (startAttempt < maxRetries && errorMessage.includes('Failed to start app')) {
          console.log(`Retrying... (attempt ${startAttempt + 1}/${maxRetries})`);
          setStartAttempt(prev => prev + 1);
          setTimeout(() => {
            const retry = async () => {
              await startApp();
            };
            retry();
          }, 2000);
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

      // Abort any in-flight start/poll loop.
      startRunIdRef.current = runId + 1;

      // Cleanup on unmount.
      // If unmounted almost immediately, this is likely React StrictMode; defer cleanup.
      // Otherwise, stop immediately so installs/builds don't keep running after navigation.
      const elapsedMs = Math.max(0, Date.now() - (effectStartedAtRef.current || 0));
      const delayMs = elapsedMs < 600 ? 1500 : 0;

      const cleanup = () => {
        pendingCleanupTimers.delete(appId);
        ensureSessionAndCsrf()
          .catch(() => null)
          .then((csrf) =>
            fetch('/api/webcontainer', {
              method: 'DELETE',
              keepalive: true,
              headers: {
                'Content-Type': 'application/json',
                ...(typeof csrf === 'string' && csrf ? { 'x-csrf': csrf } : {}),
              },
              body: JSON.stringify({ appId }),
            }).catch(console.error)
          );
      };

      const timer = window.setTimeout(cleanup, delayMs);
      pendingCleanupTimers.set(appId, timer);
    };
  }, [appId, startAttempt, restartToken]);

  // Reload the iframe without tearing down the underlying server/process.
  useEffect(() => {
    if (typeof reloadToken !== 'number') return;
    if (lastReloadTokenRef.current === reloadToken) return;
    lastReloadTokenRef.current = reloadToken;
    if (!proxyBaseRef.current) return;
    if (!previewUrl) return;

    // Force iframe reload via cache-busting query param.
    const base = proxyBaseRef.current;
    const nextUrl = `${base}?t=${Date.now()}`;
    setPreviewUrl(nextUrl);
  }, [reloadToken]);

  return (
    <div className="h-full flex flex-col bg-white text-black/90 border border-black/10 rounded-2xl shadow">
      {error && (
        <div className="p-4 border-b border-black/10">
          {isLoading && <p className="text-accent">Loading...</p>}
          {error && <p className="text-red-600">Error: {error}</p>}
        </div>
      )}
      {previewUrl ? (
        <iframe
          src={previewUrl}
          className="w-full h-full border border-black/10 rounded-lg"
          title="App Preview"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-4">
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce"></div>
            </div>
            <p className="text-lg font-medium text-gray-700">Building app...</p>
            <p className="text-sm text-gray-500 mt-1">This may take a few moments</p>
          </div>
        </div>
      )}
    </div>
  );
}