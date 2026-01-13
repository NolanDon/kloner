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
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const startApp = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch('/api/webcontainer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ appId, files }),
        });

        if (!response.ok) {
          throw new Error('Failed to start app');
        }

        await response.json();
        // Use same-origin proxy to satisfy COEP/CORP and cookies on HTTPS
        setPreviewUrl(`/api/webcontainer/${appId}/proxy/`);
      } catch (err) {
        console.error('Error starting app:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
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
  }, [appId, files]);

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