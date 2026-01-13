// components/WebContainerRunner.tsx
"use client";

import { useEffect, useRef, useState } from 'react';
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";

interface WebContainerRunnerProps {
  appId: string;
  files: { [path: string]: { content: string; lastModified: number } };
  onFileChange?: (path: string, content: string) => void;
  reloadToken?: number;
}

export default function WebContainerRunner({ appId, files, onFileChange, reloadToken }: WebContainerRunnerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startAttempt, setStartAttempt] = useState(0);
  const hasStartedRef = useRef(false);
  const maxRetries = 3;
  const proxyBaseRef = useRef<string | null>(null);
  const lastReloadTokenRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const startApp = async () => {
      try {
        setIsLoading(true);
        setError(null);

        console.log('Starting app with ID:', appId);
        console.log('Files:', Object.keys(files));

        // First check if the app exists and is ready
        const proxyUrl = `/api/webcontainer/${appId}/proxy/`;
        proxyBaseRef.current = proxyUrl;
        try {
          // Check if the app is registered (not just if proxy responds)
          const statusResponse = await fetch(`/api/webcontainer/${appId}`, { method: 'HEAD' });
          if (statusResponse.ok) {
            console.log('App exists, checking if proxy is ready');
            // App exists, now check if proxy is ready
            const checkResponse = await fetch(proxyUrl, { method: 'HEAD' });
            if (checkResponse.ok) {
              console.log('App is running and proxy is ready, using existing instance');
              setPreviewUrl(proxyUrl);
              setIsLoading(false);
              return;
            } else {
              console.log('App exists but proxy not ready yet, will start polling');
            }
          } else {
            console.log('App does not exist, will create new instance');
          }
        } catch (err) {
          console.log('App status check failed, assuming app needs to be created:', err);
        }

        const csrf = await ensureSessionAndCsrf().catch(() => null);
        const response = await fetch('/api/webcontainer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'x-csrf': csrf } : {}),
          },
          body: JSON.stringify({ appId, files }),
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
          hasStartedRef.current = false;
          setStartAttempt(prev => prev + 1);
          setTimeout(() => {
            const retry = async () => {
              hasStartedRef.current = false;
              await startApp();
            };
            retry();
          }, 2000);
        }
      } finally {
        setIsLoading(false);
      }
    };

    startApp();

    return () => {
      // Cleanup on unmount
      ensureSessionAndCsrf()
        .catch(() => null)
        .then((csrf) =>
          fetch('/api/webcontainer', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf': csrf } : {}),
        },
        body: JSON.stringify({ appId }),
          }).catch(console.error)
        );
    };
  }, [appId, files, startAttempt]);

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