// components/WebContainerRunner.tsx
"use client";

import { useEffect, useRef, useState } from 'react';

interface WebContainerRunnerProps {
  appId: string;
  files: { [path: string]: { content: string; lastModified: number } };
  onFileChange?: (path: string, content: string) => void;
}

export default function WebContainerRunner({ appId, files, onFileChange }: WebContainerRunnerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startAttempt, setStartAttempt] = useState(0);
  const hasStartedRef = useRef(false);
  const maxRetries = 3;

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

        const response = await fetch('/api/webcontainer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ appId, files }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to start app');
        }

        const data = await response.json();
        console.log('App started successfully:', data);

        // Poll the proxy endpoint to ensure it's ready
        const maxAttempts = 30; // 30 attempts * 500ms = 15 seconds max
        let attempts = 0;
        let proxyReady = false;

        while (attempts < maxAttempts && !proxyReady) {
          try {
            console.log(`Checking if proxy is ready (attempt ${attempts + 1}/${maxAttempts})...`);
            const proxyCheck = await fetch(proxyUrl, { 
              method: 'HEAD',
              cache: 'no-store',
            });
            
            if (proxyCheck.ok || proxyCheck.status === 200) {
              proxyReady = true;
              console.log('Proxy is ready!');
              break;
            } else {
              console.log(`Proxy not ready yet, status: ${proxyCheck.status}`);
            }
          } catch (err) {
            console.log('Proxy check failed:', err);
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
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
      fetch('/api/webcontainer', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ appId }),
      }).catch(console.error);
    };
  }, [appId, files, startAttempt]);

  return (
    <div className="h-full flex flex-col bg-white text-black/90 border border-black/10 rounded-2xl shadow">
      <div className="p-4 border-b border-black/10">
        <h2 className="text-xl font-semibold text-accent">App Runner</h2>
        <p className="text-black/70">App ID: {appId}</p>
        <p className="text-black/70">Files: {Object.keys(files).length}</p>
        {isLoading && <p className="text-accent">Loading...</p>}
        {error && <p className="text-red-600">Error: {error}</p>}
      </div>
      <div className="flex-1 p-4">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            className="w-full h-full border border-black/10 rounded-lg"
            title="App Preview"
          />
        ) : (
          <p className="text-black/70">Starting app...</p>
        )}
      </div>
    </div>
  );
}