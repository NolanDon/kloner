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
  const [canRetry, setCanRetry] = useState(false);
  const [startAttempt, setStartAttempt] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const maxRetries = 2; // Reduced from 3 to be less aggressive
  const retryScheduledRef = useRef(false);
  const retryApp = () => {
    setStartAttempt(0);
    setError(null);
    setPreviewUrl(null);
    setCanRetry(false);
    retryScheduledRef.current = false;
    // Force restart by changing restartToken
    restartToken = Date.now();
  };
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
        setLoadingStatus('Starting app container...');

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
          setLoadingStatus('Restarting app...');
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
        setLoadingStatus('Connecting to app...');

        // For dev environments, try multiple strategies to connect to the app
        const isLocalhost = typeof window !== 'undefined' && 
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

        // Poll the proxy endpoint to ensure it's ready.
        // This can legitimately take a while (first compile, cold start, etc).
        const maxAttempts = 60; // Reduced from 120 to be less aggressive (~1-2 minutes total)
        let attempts = 0;
        let proxyReady = false;
        let delayMs = 2000; // Start with 2s delay instead of 1s
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5; // Reduced from 10 to fail faster

        while (attempts < maxAttempts && !proxyReady && consecutiveErrors < maxConsecutiveErrors) {
          if (startRunIdRef.current !== runId) return;
          
          try {
            setLoadingStatus(`Checking connection (${attempts + 1}/${maxAttempts})...`);
            console.log(`Checking if proxy is ready (attempt ${attempts + 1}/${maxAttempts})...`);
            
            // Try multiple endpoints for better reliability
            const endpoints = [
              proxyUrl, // Main proxy endpoint
              proxyUrl.replace('/proxy/', '/proxy'), // Without trailing slash
            ];

            // If app provided a direct URL in response, also try that via proxy
            if (data.url && isLocalhost) {
              const directPort = new URL(data.url).port;
              endpoints.push(`/api/webcontainer/${appId}/proxy-direct/${directPort}/`);
            }

            // Add a fallback endpoint that might work if the proxy is misconfigured
            endpoints.push(`/api/webcontainer/${appId}/health`);

            let bestResponse = null;
            let bestStatus = 0;

            for (const endpoint of endpoints) {
              try {
                const proxyCheck = await fetch(endpoint, { 
                  method: 'HEAD',
                  cache: 'no-store',
                  signal: AbortSignal.timeout(5000), // 5s timeout per check
                });

                if (proxyCheck.status > bestStatus) {
                  bestResponse = proxyCheck;
                  bestStatus = proxyCheck.status;
                }

                // Auth failures won't fix themselves.
                if (proxyCheck.status === 401 || proxyCheck.status === 403) {
                  throw new Error('Not authorized to access preview (session/scope).');
                }

                // Consider any 2xx or 3xx a success (redirects are OK)
                if ((proxyCheck.status >= 200 && proxyCheck.status < 400) || proxyCheck.ok) {
                  proxyReady = true;
                  setLoadingStatus('Connected! Loading app...');
                  console.log(`Proxy is ready! (endpoint: ${endpoint}, status: ${proxyCheck.status})`);
                  // Update proxyUrl to the working endpoint
                  proxyBaseRef.current = endpoint;
                  break;
                }
              } catch (endpointError) {
                console.log(`Endpoint ${endpoint} failed:`, endpointError);
              }
            }

            if (proxyReady) break;

            if (proxyReady) break;

            // Log the best status we got
            if (bestResponse) {
              console.log(`Proxy not ready yet, best status: ${bestStatus}`);
              
              // Reset consecutive error count on any response
              consecutiveErrors = 0;
              
              // If we're getting 4xx/5xx but the server is responding, reduce delay for faster retries
              if (bestStatus >= 400 && bestStatus < 600) {
                delayMs = Math.max(1000, delayMs * 0.9); // More conservative delay reduction
                
                // Special handling for 500 errors - they might be transient but don't rush
                if (bestStatus === 500) {
                  console.log('Got 500 error - this might be a temporary server issue, continuing with normal pacing');
                  // Don't reduce delay further for 500s
                }
              }
            } else {
              consecutiveErrors++;
              console.log(`No response from proxy (consecutive errors: ${consecutiveErrors})`);
              
              // Increase delay on consecutive connection failures (more gradual)
              if (consecutiveErrors >= 2) {
                delayMs = Math.min(4000, delayMs * 1.2);
              }
            }

          } catch (err) {
            consecutiveErrors++;
            console.log(`Proxy check failed (consecutive errors: ${consecutiveErrors}):`, err);
            
            // Gradual backoff on errors (less aggressive)
            if (consecutiveErrors >= 3) {
              delayMs = Math.min(5000, delayMs * 1.5);
            }
          }

          // Simpler, more graceful delay: gradually increase from 2s to max 5s
          const progressDelay = Math.min(5000, delayMs + (attempts * 100));
          await new Promise(resolve => setTimeout(resolve, progressDelay));
          attempts++;
        }

        if (consecutiveErrors >= maxConsecutiveErrors) {
          // Try one final fallback: direct connection attempt if available
          if (data.url && isLocalhost) {
            console.log('Trying direct connection as final fallback...');
            try {
              const directCheck = await fetch(data.url, {
                method: 'HEAD',
                mode: 'no-cors', // Handle CORS issues
                signal: AbortSignal.timeout(3000),
              });
              console.log('Direct connection seems to work, using proxy anyway for security');
            } catch (directError) {
              console.log('Direct connection also failed:', directError);
            }
          }
          
          // If all proxy attempts failed, provide a more helpful error message
          const errorMsg = `Proxy endpoint did not become ready after ${attempts} attempts over ${Math.round((attempts * delayMs) / 1000)}s. The app appears to be running (started successfully), but the proxy connection is failing with 500 errors. This usually indicates a server-side proxy configuration issue.`;
          
          console.error('Proxy connection failed:', errorMsg);
          throw new Error(errorMsg);
        }
        
        // Use same-origin proxy to satisfy COEP/CORP and cookies on HTTPS
        setPreviewUrl(proxyBaseRef.current);
      } catch (err) {
        console.error('Error starting app:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        
        // Classify error types for better retry logic
        const isNetworkError = errorMessage.includes('Failed to fetch') || 
                              errorMessage.includes('NetworkError') ||
                              errorMessage.includes('ERR_') ||
                              errorMessage.includes('net::');
        
        const isServerError = errorMessage.includes('Failed to start app') ||
                             errorMessage.includes('500') ||
                             errorMessage.includes('Internal Server Error');
        
        const isTimeout = errorMessage.includes('timeout') || 
                         errorMessage.includes('did not become ready');
        
        const isProxyError = errorMessage.includes('Proxy endpoint') ||
                            errorMessage.includes('proxy connection');
        
        const isRetryable = isNetworkError || isServerError || isTimeout || isProxyError;
        
        // Retry logic for transient failures
        if (startAttempt < maxRetries && isRetryable && !retryScheduledRef.current) {
          // More graceful retry with longer delays: 3s, 8s (instead of 1s, 2s, 4s)
          const retryDelay = startAttempt === 0 ? 3000 : 8000;
          console.log(`Retrying in ${retryDelay}ms... (attempt ${startAttempt + 1}/${maxRetries})`);
          console.log(`Error type: ${isNetworkError ? 'Network' : isServerError ? 'Server' : isTimeout ? 'Timeout' : 'Unknown'}`);
          
          setStartAttempt(prev => prev + 1);
          setCanRetry(false); // Disable retry button during automatic retry
          retryScheduledRef.current = true;
          
          setTimeout(() => {
            retryScheduledRef.current = false;
            // Reset some state for retry
            setError(null);
            const retry = async () => {
              await startApp();
            };
            retry();
          }, retryDelay);
        } else if (startAttempt >= maxRetries) {
          let finalErrorMessage = `Failed after ${maxRetries} attempts: ${errorMessage}`;
          
          if (isProxyError) {
            finalErrorMessage += '\n\nThe app started successfully, but the connection proxy is failing. This is usually a temporary server issue. Try refreshing the page or waiting a few minutes before trying again.';
          } else if (isServerError) {
            finalErrorMessage += '\n\nThis appears to be a server-side issue. The app builder service may be temporarily unavailable. Please try again in a few minutes.';
          }
          
          setError(finalErrorMessage);
          setCanRetry(true);
        } else {
          // Non-retryable error
          console.log('Error is not retryable:', errorMessage);
          setCanRetry(false);
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
          {error && (
            <div className="space-y-3">
              <p className="text-red-600 whitespace-pre-line">{error}</p>
              {canRetry && (
                <button
                  onClick={retryApp}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-[#e54f1a] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Try Again
                </button>
              )}
            </div>
          )}
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
          <div className="text-center max-w-md">
            <div className="flex items-center justify-center gap-1 mb-4">
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce"></div>
            </div>
            <p className="text-lg font-medium text-gray-700">
              {isLoading && startAttempt === 0 ? 'Building app...' : `Retry ${Math.min(startAttempt + 1, maxRetries + 1)}/${maxRetries + 1}...`}
            </p>
            <p className="text-sm text-gray-500 mt-1">{loadingStatus}</p>
            {startAttempt > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                Some apps take longer to start on first run
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}