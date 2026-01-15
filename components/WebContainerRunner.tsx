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
  const totalAttemptsRef = useRef(0); // Circuit breaker for infinite retries
  const maxTotalAttempts = 10; // Absolute maximum attempts across all retries (increased from 5)
  const assetFailureCountRef = useRef(0); // Track 404s for static assets
  const maxAssetFailures = 3; // Rebuild after this many asset 404s
  const rebuildScheduledRef = useRef(false); // Prevent multiple rebuilds
  const appLoadedSuccessfullyRef = useRef(false); // Track if app server is successfully loaded
  const iframeLoadedSuccessfullyRef = useRef(false); // Track if iframe loaded successfully
  
  const handleAssetFailure = () => {
    // Don't count failures if app already loaded successfully
    if (appLoadedSuccessfullyRef.current) return;
    
    assetFailureCountRef.current += 1;
    console.log(`Asset failure detected (${assetFailureCountRef.current}/${maxAssetFailures})`);
    
    if (assetFailureCountRef.current >= maxAssetFailures && !rebuildScheduledRef.current && totalAttemptsRef.current < maxTotalAttempts) {
      console.log('Too many asset failures, triggering rebuild...');
      rebuildScheduledRef.current = true;
      
      // Reset failure count for the rebuild
      assetFailureCountRef.current = 0;
      
      // Trigger a rebuild by incrementing startAttempt
      setStartAttempt(prev => prev + 1);
    }
  };
  const retryApp = () => {
    setStartAttempt(0);
    setError(null);
    setPreviewUrl(null);
    setCanRetry(false);
    setLoadingStatus(''); // Clear loading status on retry
    retryScheduledRef.current = false;
    totalAttemptsRef.current = 0; // Reset circuit breaker on manual retry
    assetFailureCountRef.current = 0; // Reset asset failure count
    rebuildScheduledRef.current = false; // Reset rebuild flag
    appLoadedSuccessfullyRef.current = false; // Reset server success flag
    iframeLoadedSuccessfullyRef.current = false; // Reset iframe success flag
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

  // Monitor app loading and trigger rebuilds on asset failures
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
            console.log('Critical asset 404 detected, triggering rebuild check...');
            handleAssetFailure();
          } else if (response.ok) {
            // Reset failure count on successful asset fetch
            assetFailureCountRef.current = 0;
          }
        } catch (error) {
          // Ignore fetch errors, might be network issues
        }
      }, 10000); // Check every 10 seconds (less aggressive)

      return () => clearInterval(healthCheckInterval);
    }, 15000); // Wait 15 seconds before starting health checks

    return () => clearTimeout(healthCheckDelay);
  }, [previewUrl]);

  // Monitor iframe loading and trigger rebuilds if it fails
  useEffect(() => {
    if (!previewUrl) return;

    const loadTimeout = setTimeout(() => {
      // If iframe hasn't loaded successfully after 30 seconds, assume asset failures
      if (!iframeLoadedSuccessfullyRef.current) {
        console.log('Iframe load timeout - triggering rebuild check...');
        handleAssetFailure();
      }
    }, 30000); // 30 seconds to load

    return () => clearTimeout(loadTimeout);
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
        setIsLoading(true);
        setError(null);
        setPreviewUrl(null);
        setLoadingStatus('Starting app container... (This may take 1-2 minutes for first-time builds)');

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
            if (!csrf) {
              console.log('No CSRF token available for restart cleanup');
            } else {
              await fetch('/api/webcontainer', {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/json',
                  'x-csrf': csrf,
                },
                body: JSON.stringify({ appId }),
              });
            }
          } catch (e) {
            console.log('Restart cleanup failed (continuing):', e);
          }
        }

        if (typeof restartToken === 'number') {
          lastRestartTokenRef.current = restartToken;
        }

        const csrf = await ensureSessionAndCsrf().catch(() => null);
        console.log('CSRF token obtained:', csrf ? 'present' : 'null');
        
        if (!csrf) {
          throw new Error('Failed to obtain CSRF token. Please refresh the page and try again.');
        }
        
        const response = await fetch('/api/webcontainer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf': csrf,
          },
          body: JSON.stringify({ appId, files: filesRef.current }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to start app');
        }

        const data = await response.json();
        console.log('App started successfully:', data);
        setLoadingStatus('Installing dependencies and building app... (1-2 minutes)');

        // For dev environments, try multiple strategies to connect to the app
        const isLocalhost = typeof window !== 'undefined' && 
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

        // Poll the proxy endpoint to ensure it's ready.
        // This can legitimately take a while (first compile, cold start, etc).
        const maxAttempts = 5; // Moderate polling attempts (~30-60 seconds total)
        let attempts = 0;
        let proxyReady = false;
        let delayMs = 2000; // Start with 2s delay instead of 1s
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5; // Reduced from 10 to fail faster

        while (attempts < maxAttempts && !proxyReady && consecutiveErrors < maxConsecutiveErrors) {
          if (startRunIdRef.current !== runId) return;
          
          try {
            setLoadingStatus(`Building and connecting... (${attempts + 1}/${maxAttempts}) - Large apps may take longer`);
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
                  setLoadingStatus('App built successfully! Loading interface...');
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
        appLoadedSuccessfullyRef.current = true; // Mark as successfully loaded when proxy is ready
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
        
        const isDiskSpaceError = errorMessage.includes('Insufficient disk space');
        
        const isRetryable = (isNetworkError || isServerError || isTimeout || isProxyError) && !isDiskSpaceError;
        
        // Circuit breaker: prevent infinite retries
        totalAttemptsRef.current += 1;
        const maxTotalAttempts = 10; // Absolute maximum attempts across all retries
        
        // Retry logic for transient failures
        if (startAttempt < maxRetries && isRetryable && !retryScheduledRef.current && totalAttemptsRef.current <= maxTotalAttempts) {
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

      // Abort any in-flight start/poll loop.
      startRunIdRef.current = runId + 1;

      // Only cleanup if there's no active preview URL (app not successfully loaded)
      // This prevents killing apps that are actively being viewed
      if (previewUrl && appLoadedSuccessfullyRef.current) {
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
            return fetch('/api/webcontainer', {
              method: 'DELETE',
              keepalive: true,
              headers: {
                'Content-Type': 'application/json',
                'x-csrf': csrf,
              },
              body: JSON.stringify({ appId }),
            }).catch(console.error);
          });
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
  }, [reloadToken, previewUrl]);

  return (
    <div className="h-full flex flex-col bg-white text-black/90 border border-black/10 rounded-2xl shadow">
      {error && (
        <div className="p-4 border-b border-black/10">
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
        </div>
      )}
      {previewUrl ? (
        <iframe
          src={previewUrl}
          className="w-full h-full border border-black/10 rounded-lg"
          title="App Preview"
          onLoad={() => {
            console.log('Iframe loaded successfully');
            setLoadingStatus(''); // Clear loading status when app is ready
            iframeLoadedSuccessfullyRef.current = true; // Mark iframe as successfully loaded
            // Reset asset failure count on successful load
            assetFailureCountRef.current = 0;
          }}
          onError={() => {
            console.log('Iframe failed to load');
            handleAssetFailure();
          }}
        />
      ) : !error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="flex items-center justify-center gap-1 mb-4">
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce"></div>
            </div>
            <p className="text-lg font-medium text-gray-700">
              {isLoading && startAttempt === 0 ? 'Building your app...' : startAttempt > 0 ? `Rebuilding after issues... (${Math.min(startAttempt + 1, maxRetries + 1)}/${maxRetries + 1})` : 'Loading app...'}
            </p>
            <p className="text-sm text-gray-500 mt-1">{loadingStatus}</p>
            {startAttempt > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                Some apps take longer to start on first run
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}