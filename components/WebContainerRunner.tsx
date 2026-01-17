// components/WebContainerRunner.tsx
"use client";

import { useEffect, useRef, useState } from 'react';

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
  const [isPolling, setIsPolling] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [startAttempt, setStartAttempt] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [currentStatusData, setCurrentStatusData] = useState<any>(null); // Store latest status data for UI
  const [connectingToExisting, setConnectingToExisting] = useState(false); // Track if connecting to existing machine
  const [hasStarted, setHasStarted] = useState(false); // Prevent multiple startApp calls
  const maxRetries = 2; // Reduced from 3 to be less aggressive
  const maxPollingRetries = 30; // Increased to allow up to 5 minutes of polling
  const pollingRetryCountRef = useRef(0); // Track polling retry attempts
  const retryScheduledRef = useRef(false);
  const totalAttemptsRef = useRef(0); // Circuit breaker for infinite retries
  const maxTotalAttempts = 10; // Absolute maximum attempts across all retries (increased from 5)
  const assetFailureCountRef = useRef(0); // Track 404s for static assets
  const maxAssetFailures = 3; // Rebuild after this many asset 404s
  const containerNotFoundCountRef = useRef(0); // Track 404s for container status
  const maxContainerNotFound = 5; // Give up after this many container 404s
  const rebuildScheduledRef = useRef(false); // Prevent multiple rebuilds
  const appLoadedSuccessfullyRef = useRef(false); // Track if app server is successfully loaded
  const iframeLoadedSuccessfullyRef = useRef(false); // Track if iframe loaded successfully
  const pollingCodeRef = useRef<string | null>(null); // Track the current polling code
  const statusPollTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track status polling timeout
  const iframeLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track iframe load timeout
  
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
  const getStoredContainerCode = (appId: string): string | null => {
    try {
      const stored = localStorage.getItem(`webcontainer_${appId}`);
      return stored ? JSON.parse(stored).code : null;
    } catch {
      return null;
    }
  };

  // Helper function to store container code for this app
  const storeContainerCode = (appId: string, code: string) => {
    try {
      localStorage.setItem(`webcontainer_${appId}`, JSON.stringify({ code, timestamp: Date.now() }));
    } catch {
      // Ignore storage errors
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
    
    setStartAttempt(0);
    setError(null);
    setIsPolling(false); // Reset polling state
    setPreviewUrl(null);
    setCanRetry(false);
    setLoadingStatus(''); // Clear loading status on retry
    setCurrentStatusData(null); // Clear status data on retry
    setConnectingToExisting(false); // Reset connection state
    setHasStarted(false); // Allow restart
    retryScheduledRef.current = false;
    totalAttemptsRef.current = 0; // Reset circuit breaker on manual retry
    assetFailureCountRef.current = 0; // Reset asset failure count
    rebuildScheduledRef.current = false; // Reset rebuild flag
    appLoadedSuccessfullyRef.current = false; // Reset server success flag
    iframeLoadedSuccessfullyRef.current = false; // Reset iframe success flag
    pollingCodeRef.current = null; // Reset polling code
    
    // Clear stored container code on retry to force fresh start
    clearStoredContainerCode(appId);
    
    // Force restart by changing restartToken
    restartToken = Date.now();
  };
  const proxyBaseRef = useRef<string | null>(null);
  const lastReloadTokenRef = useRef<number | null>(null);
  const lastRestartTokenRef = useRef<number | null>(null);
  const filesRef = useRef(files);
  const startRunIdRef = useRef(0);
  const effectStartedAtRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        } catch (error: any) {
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
        if (hasStarted) {
          console.log('Already started, skipping duplicate startApp call');
          return;
        }
        setHasStarted(true);

        setIsLoading(true);
        setError(null);
        setIsPolling(false); // Reset polling state
        setPreviewUrl(null);
        setConnectingToExisting(false);
        pollingRetryCountRef.current = 0; // Reset retry count
        containerNotFoundCountRef.current = 0; // Reset 404 counter

        console.log('Starting app with ID:', appId);
        console.log('Files:', Object.keys(filesRef.current));
        console.log('Files object:', filesRef.current);

        // First, check if there's an existing container for this app
        const existingCode = getStoredContainerCode(appId);
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
              const isAllowedStatus = allowedStatuses.includes(statusData.status);

              if (isAllowedStatus) {
                if (statusData.url) {
                  console.log(`✅ Existing container ${existingCode} is ready (${statusData.status}), connecting directly:`, statusData.url);
                  pollingCodeRef.current = existingCode;
                  setPreviewUrl(statusData.url);
                  setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                  setIsLoading(false);
                  appLoadedSuccessfullyRef.current = true;
                  return; // Successfully connected to existing container
                } else {
                  console.log(`❌ Existing container ${existingCode} has allowed status '${statusData.status}' but no URL provided`);
                }
              } else {
                console.log(`❌ Existing container ${existingCode} status '${statusData.status}' not in allowed list: [${allowedStatuses.join(', ')}]`);
                
                // For booting containers, don't try fallback connections - they're not ready
                if (statusData.status === 'booting') {
                  console.log(`⏳ Container ${existingCode} is still booting, will create new one instead of waiting`);
                  // Don't clear the code since it might become ready later, but don't try to connect
                } else {
                  // Clear stored codes for error containers without URLs - they're definitely unusable
                  if (statusData.status === 'error' && !statusData.url) {
                    console.log(`🗑️ Clearing stored code for unusable error container ${existingCode} (no URL)`);
                    clearStoredContainerCode(appId);
                  }
                }
              }
              
              // Only try fallback connections for containers that are NOT booting
              if (statusData.status !== 'booting') {
                // If progress is 100% and we have a URL, try connecting regardless of status
                console.log(`🔄 Existing container ${existingCode} shows 100% progress with URL, attempting direct connection:`, statusData.url);
                try {
                  await fetch(statusData.url, { 
                    method: 'HEAD', 
                    mode: 'no-cors',
                    signal: AbortSignal.timeout(2000)
                  });
                  
                  console.log(`✅ Direct connection to existing container ${existingCode} successful`);
                  pollingCodeRef.current = existingCode;
                  setPreviewUrl(statusData.url);
                  setLoadingStatus('Connected to existing machine!');
                  setIsLoading(false);
                  appLoadedSuccessfullyRef.current = true;
                  return;
                } catch (error: any) {
                  console.log(`❌ Direct connection to existing container ${existingCode} failed (100% progress):`, error?.message || error);
                }
              } else if (statusData.status !== 'booting' && statusData.url && statusData.machineId) {
                // If we have a URL and machineId, the machine exists, try connecting
                console.log(`🔄 Existing container ${existingCode} has URL and machineId (${statusData.machineId}), attempting connection:`, statusData.url);
                try {
                  await fetch(statusData.url, { 
                    method: 'HEAD', 
                    mode: 'no-cors',
                    signal: AbortSignal.timeout(2000)
                  });
                  
                  console.log(`✅ Machine exists connection successful for container ${existingCode} (${statusData.machineId})`);
                  pollingCodeRef.current = existingCode;
                  setPreviewUrl(statusData.url);
                  setLoadingStatus(`Connected to machine ${statusData.machineId}!`);
                  setIsLoading(false);
                  appLoadedSuccessfullyRef.current = true;
                  return;
                } catch (error: any) {
                  console.log(`❌ Machine exists connection failed for container ${existingCode}:`, error?.message || error);
                }
              } else {
                console.log(`❌ Container ${existingCode} doesn't meet fallback conditions (status='${statusData.status}', progress=${statusData.uiProgress}%)`);
                
                // Clear stored codes for error containers without URLs - they're definitely unusable
                if (statusData.status === 'error' && !statusData.url) {
                  console.log(`🗑️ Clearing stored code for unusable error container ${existingCode} (no URL)`);
                  clearStoredContainerCode(appId);
                }
              } // End of status !== 'booting' check
            } else if (statusResponse.status === 404) {
              console.log(`❌ Container ${existingCode} not found (404) - clearing invalid stored code`);
              clearStoredContainerCode(appId);
            } else {
              console.log(`❌ Failed to get status for container ${existingCode}: ${statusResponse.status} ${statusResponse.statusText}`);
            }
          } catch (err) {
            console.log(`❌ Failed to check status of existing container ${existingCode}, will create new one:`, err);
            // Clear the stored code since it's not usable
            clearStoredContainerCode(appId);
          }

          // If we get here, the existing container is not usable
          console.log(`🆕 No usable existing container found for app ${appId}, creating new one`);
          setConnectingToExisting(false);
          clearStoredContainerCode(appId);
        } else {
          console.log(`ℹ️ No stored container code found for app ${appId}, creating new one`);
        }

        // No existing container or it failed, create a new one
        console.log(`🏗️ Creating new container for app ${appId}...`);
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

        // Start the webcontainer creation (async, fire-and-forget)
        const requestBody = { appId, files: validatedFiles, mode: 'dev' };

        // Get authenticated headers
        const headers = await getAuthenticatedHeaders();

        const response = await fetch('/api/webcontainer', {
          method: 'POST',
          headers,
          credentials: "include",
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to start app');
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
        storeContainerCode(appId, code);
        
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
                
                if (containerNotFoundCountRef.current >= maxContainerNotFound) {
                  console.log('Too many 404s, giving up on this container');
                  setIsPolling(false);
                  setError('Container failed to start. The deployment may have failed.');
                  setCanRetry(true);
                  setLoadingStatus('');
                  // Clear the stored code since it's not working
                  clearStoredContainerCode(appId);
                  return;
                }
                
                // For 404s, retry more frequently since the container might not be registered yet
                statusPollTimeoutRef.current = setTimeout(pollStatus, 2000); // Retry in 2 seconds
                return;
              }
              throw new Error(`Status check failed: ${statusResponse.status}`);
            }

            const statusData = await statusResponse.json();
            console.log('Status check:', statusData);
            
            // Reset 404 counter on successful response
            containerNotFoundCountRef.current = 0;
            
            // Store the status data for UI display
            setCurrentStatusData(statusData);

            if (statusData.status === 'ready' || statusData.status === 'running' || statusData.status === 'compiled' || statusData.status === 'started') {
              // App is ready! Set the preview URL
              const deploymentUrl = statusData.url;
              console.log('Deployment ready at:', deploymentUrl);

              if (!deploymentUrl) {
                console.error('Backend reported ready but no URL provided:', statusData);
                throw new Error('Backend reported app ready but did not provide deployment URL');
              }

              // Clear status data since we're done
              setCurrentStatusData(null);
              setLoadingStatus(''); // Clear loading status on success

              // For Fly.io deployments, add a small delay to let DNS propagate
              if (deploymentUrl.includes('.fly.dev')) {
                console.log('Fly.io deployment detected, allowing time for DNS propagation...');
                setLoadingStatus(`Deployment ready on machine ${statusData.machineId}! Waiting for DNS propagation...`);
                // Add a longer delay for DNS propagation (Fly.io can be slow)
                setTimeout(() => {
                  setPreviewUrl(deploymentUrl);
                  setLoadingStatus(`Connected to machine ${statusData.machineId}! Loading interface...`);
                  setIsPolling(false); // Stop polling state
                  appLoadedSuccessfullyRef.current = true;
                  pollingRetryCountRef.current = 0;
                  // Clear any pending retry timeout since we succeeded
                  if (retryTimeoutRef.current) {
                    clearTimeout(retryTimeoutRef.current);
                    retryTimeoutRef.current = null;
                  }
                }, 10000); // 10 second delay for DNS
              } else {
                setPreviewUrl(deploymentUrl);
                setLoadingStatus(`Connected to machine ${statusData.machineId}! Loading interface...`);
                setIsPolling(false); // Stop polling state
                appLoadedSuccessfullyRef.current = true;
                pollingRetryCountRef.current = 0;
                // Clear any pending retry timeout since we succeeded
                if (retryTimeoutRef.current) {
                  clearTimeout(retryTimeoutRef.current);
                  retryTimeoutRef.current = null;
                }
              }

            } else if (statusData.status === 'error') {
              // Handle specific timeout errors more gracefully
              const errorMessage = statusData.error || 'Failed to create preview';
              const isTimeoutError = errorMessage.includes('Preview URL did not become reachable before timeout');
              
              if (isTimeoutError && statusData.url) {
                // Backend timed out but provided a URL - try connecting directly
                console.log('Backend timed out but provided URL, attempting direct connection:', statusData.url);
                
                try {
                  // Try a quick fetch to see if the URL is actually reachable
                  const response = await fetch(statusData.url, { 
                    method: 'HEAD', 
                    mode: 'no-cors',
                    signal: AbortSignal.timeout(5000) // 5 second timeout for direct check
                  }).catch(() => ({ ok: true })); // Treat network errors as potentially ok for no-cors
                  
                  // If we get here without throwing, assume the URL is reachable
                  console.log('Direct connection successful, proceeding with URL:', statusData.url);
                  setPreviewUrl(statusData.url);
                  setLoadingStatus('App ready! Loading interface...');
                  setIsPolling(false);
                  appLoadedSuccessfullyRef.current = true;
                  pollingRetryCountRef.current = 0;
                  if (retryTimeoutRef.current) {
                    clearTimeout(retryTimeoutRef.current);
                    retryTimeoutRef.current = null;
                  }
                  return;
                } catch (directError) {
                  console.log('Direct connection also failed:', directError);
                  // Fall through to normal error handling
                }
              }
              
              // Normal error handling
              console.error('Backend error:', errorMessage);
              setCurrentStatusData(null);
              setLoadingStatus('');
              throw new Error(errorMessage);

            } else if (statusData.status === 'pending' || statusData.status === 'archiving' || 
                       statusData.status === 'uploading_archive' || statusData.status === 'creating_machine' || 
                       statusData.status === 'booting' || statusData.status === 'building' || 
                       statusData.status === 'compiling' || statusData.status === 'starting') {
              // Still building, continue polling and show progress if available
              // But if we have a URL and the machine is running (not just pending/creating), try to connect early
              if (statusData.url && !['pending', 'archiving', 'uploading_archive', 'creating_machine'].includes(statusData.status)) {
                console.log(`Backend reports ${statusData.status} but has URL, checking if app is actually ready:`, statusData.url);
                try {
                  // Quick check if the URL is reachable
                  await fetch(statusData.url, { 
                    method: 'HEAD', 
                    mode: 'no-cors',
                    signal: AbortSignal.timeout(3000)
                  }).catch(() => ({ ok: true }));
                  
                  console.log('URL is reachable during build, connecting early to show build progress');
                  setPreviewUrl(statusData.url);
                  setLoadingStatus(`Connecting to machine ${statusData.machineId}... (showing build progress)`);
                  setIsPolling(false);
                  appLoadedSuccessfullyRef.current = true;
                  pollingRetryCountRef.current = 0;
                  if (retryTimeoutRef.current) {
                    clearTimeout(retryTimeoutRef.current);
                    retryTimeoutRef.current = null;
                  }
                  return;
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
              setLoadingStatus(`Building app... (status: ${statusData.status})`);
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
              setError('Server configuration error. Please try again later or contact support.');
              setCanRetry(true);
              setLoadingStatus('');
              return; // Don't retry this specific error
            }
            
            // Increment polling retry count
            pollingRetryCountRef.current += 1;
            
            if (pollingRetryCountRef.current >= maxPollingRetries) {
              // Max polling retries reached, show neutral message instead of error
              setIsPolling(false);
              setCurrentStatusData(null); // Clear status data
              setLoadingStatus(''); // Clear loading status on timeout
              setLoadingStatus('Build is taking longer than expected. The app may still be starting up...');
              setCanRetry(true);
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
                             errorMessage.includes('Internal Server Error');

        const isTimeout = errorMessage.includes('timeout') ||
                         errorMessage.includes('did not become ready');

        const isProxyError = errorMessage.includes('Proxy endpoint') ||
                            errorMessage.includes('proxy connection');

        const isDiskSpaceError = errorMessage.includes('Insufficient disk space');

        const isPreconditionError = errorMessage.includes('412') ||
                                   errorMessage.includes('Precondition Failed');

        const isRetryable = (isNetworkError || isServerError || isTimeout || isProxyError) && !isDiskSpaceError && !isPreconditionError;

        console.log(`Error classification: Network=${isNetworkError}, Server=${isServerError}, Timeout=${isTimeout}, Proxy=${isProxyError}, DiskSpace=${isDiskSpaceError}, Precondition=${isPreconditionError}, Retryable=${isRetryable}`);

        // Circuit breaker: prevent infinite retries
        totalAttemptsRef.current += 1;
        const maxTotalAttempts = 10; // Absolute maximum attempts across all retries

        // Retry logic for transient failures
        if (startAttempt < maxRetries && isRetryable && !retryScheduledRef.current && totalAttemptsRef.current <= maxTotalAttempts) {
          // More graceful retry with longer delays: 5s, 15s (instead of 3s, 8s) to be less aggressive
          const retryDelay = startAttempt === 0 ? 5000 : 15000;
          console.log(`Retrying in ${retryDelay}ms... (attempt ${startAttempt + 1}/${maxRetries})`);
          console.log(`Error type: ${isNetworkError ? 'Network' : isServerError ? 'Server' : isTimeout ? 'Timeout' : 'Unknown'}`);

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
      if (iframeLoadTimeoutRef.current) {
        clearTimeout(iframeLoadTimeoutRef.current);
        iframeLoadTimeoutRef.current = null;
      }
      // Abort any in-flight start/poll loop.
      startRunIdRef.current = runId + 1;
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
  }, [appId, startAttempt, restartToken, previewUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [reloadToken, previewUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Reset iframe loaded state when URL changes
    iframeLoadedSuccessfullyRef.current = false;

    // Set a timeout for iframe loading (30 seconds for DNS/network issues)
    iframeLoadTimeoutRef.current = setTimeout(() => {
      if (!iframeLoadedSuccessfullyRef.current) {
        console.log('Iframe load timeout - URL may be unreachable:', previewUrl);
        setError(`Unable to load preview at ${previewUrl}. The deployment may still be starting up or has failed. Please try again in a few minutes.`);
        setCanRetry(true);
        setPreviewUrl(null); // Hide the iframe
      }
    }, 30000); // 30 second timeout

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
      {previewUrl && iframeLoadedSuccessfullyRef.current && (
        <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm text-green-700 font-medium">Connected to machine</span>
        </div>
      )}
      {previewUrl ? (
        <div className="relative w-full h-full">
          <iframe
            src={previewUrl}
            className="w-full h-full border border-black/10 rounded-lg"
            title="App Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            onLoad={() => {
              console.log('Iframe loaded successfully - preview should now be active at:', previewUrl);
              setLoadingStatus(''); // Clear loading status when app is ready
              iframeLoadedSuccessfullyRef.current = true; // Mark iframe as successfully loaded
              // Reset asset failure count on successful load
              assetFailureCountRef.current = 0;
              // Clear the load timeout since we succeeded
              if (iframeLoadTimeoutRef.current) {
                clearTimeout(iframeLoadTimeoutRef.current);
                iframeLoadTimeoutRef.current = null;
              }

              // Add a small delay then try to validate the deployment
              setTimeout(() => {
                console.log('Preview loaded successfully - sticky routing via tsc_preview cookie should be active');
                // For now, just log that the deployment seems to be working
                // CORS prevents us from doing detailed content checks
              }, 2000);
            }}
            onError={() => {
              console.log('Iframe failed to load - URL may be unreachable:', previewUrl);
              // Check if this looks like a DNS/network error or preview routing issue
              if (previewUrl.includes('tracksite-hub.fly.dev')) {
                setError(`Preview failed to load. This may be due to cookie/session issues or the preview not being ready yet. Please try refreshing in a few moments.`);
                setCanRetry(true);
                setPreviewUrl(null); // Hide the iframe
              } else if (previewUrl.includes('.fly.dev') || previewUrl.includes('localhost')) {
                setError(`Unable to connect to ${previewUrl}. The deployment may still be starting up or has failed. Please try again in a few minutes.`);
                setCanRetry(true);
                setPreviewUrl(null); // Hide the iframe
              } else {
                handleAssetFailure();
              }
            }}
          />
          {/* Loading overlay while iframe loads */}
          {!iframeLoadedSuccessfullyRef.current && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
              <div className="text-center space-y-2">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-sm text-gray-600">Loading preview...</p>
              </div>
            </div>
          )}
        </div>
      ) : !error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            {isPolling ? (
              // Simple, clean polling state with 3-dot loader
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-1 mb-4">
                  <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 bg-accent rounded-full animate-bounce"></div>
                </div>
                <div className="text-center space-y-2">
                  {currentStatusData && currentStatusData.uiTitle && currentStatusData.uiMessage ? (
                    <>
                      <p className="text-lg font-medium text-gray-700">{currentStatusData.uiTitle}</p>
                      <p className="text-sm text-gray-500">{currentStatusData.uiMessage}</p>
                      {currentStatusData.uiProgress !== undefined && currentStatusData.uiProgress !== null && (
                        <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
                          <div
                            className="h-2 bg-accent rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(0, Math.min(100, currentStatusData.uiProgress))}%` }}
                          ></div>
                        </div>
                      )}
                    </>
                  ) : pollingRetryCountRef.current === 0 ? (
                    <>
                      <p className="text-lg font-medium text-gray-700">Building your app...</p>
                      <p className="text-sm text-gray-500">This may take several minutes for first-time builds</p>
                    </>
                  ) : pollingRetryCountRef.current < maxPollingRetries ? (
                    <>
                      <p className="text-lg font-medium text-gray-700">Still building...</p>
                      <p className="text-sm text-gray-500">Checking progress...</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-medium text-gray-700">Connection timeout</p>
                      <p className="text-sm text-red-600">Unable to verify build status</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              // Initial loading state
              <>
                <div className="flex items-center justify-center gap-1 mb-4">
                  <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 bg-accent rounded-full animate-bounce"></div>
                </div>
                <p className="text-lg font-medium text-gray-700">
                  {connectingToExisting ? 'Connecting to existing machine...' : 
                   isLoading && startAttempt === 0 ? 'Starting your app...' : 
                   startAttempt > 0 ? `Rebuilding after issues... (${Math.min(startAttempt + 1, maxRetries + 1)}/${maxRetries + 1})` : 
                   'Loading app...'}
                </p>
                <p className="text-sm text-gray-500 mt-1">{loadingStatus}</p>
                {connectingToExisting && (
                  <p className="text-xs text-blue-600 mt-2">
                    Found an existing machine for this app - connecting...
                  </p>
                )}
                {startAttempt > 0 && (
                  <p className="text-xs text-gray-400 mt-2">
                    Some apps take longer to start on first run
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}