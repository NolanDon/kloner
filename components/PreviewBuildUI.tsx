"use client";

import { useEffect, useState } from 'react';
import { doc, onSnapshot, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface PreviewBuildUIProps {
  userId: string;
  appId: string;
  code: string;
}

interface PreviewData {
  status?: string;
  uiTitle?: string;
  uiMessage?: string;
  uiProgress?: number;
  uiProgressLabel?: string;
  uiStage?: string;
  url?: string;
  error?: string;
}

export default function PreviewBuildUI({ userId, appId, code }: PreviewBuildUIProps) {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeRetries, setIframeRetries] = useState(0);
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    if (!userId || !appId || !code) return;

    const docRef = doc(db, 'kloner_users', userId, 'kloner_apps', appId, 'previews', code);

    const unsubscribe = onSnapshot(docRef, (doc) => {
      if (doc.exists()) {
        setPreviewData(doc.data() as PreviewData);
      } else {
        setPreviewData({ status: 'error', error: 'Preview not found' });
      }
      setLoading(false);
    }, (error) => {
      console.error('Error listening to preview doc:', error);
      setPreviewData({ status: 'error', error: 'Failed to load preview status' });
      setLoading(false);
    });

    return unsubscribe;
  }, [userId, appId, code]);

  const getProgressLabel = (data: PreviewData) => {
    if (data.uiProgressLabel) return data.uiProgressLabel;
    if (data.uiStage) {
      // Derive user-friendly labels from stages
      const stageLabels: Record<string, string> = {
        preparing_files: 'Preparing files',
        uploading_files: 'Uploading files',
        creating_server: 'Creating server',
        downloading: 'Downloading',
        installing: 'Installing',
        building: 'Building',
        starting_app: 'Starting app',
        ready: 'Ready',
        stopped: 'Stopped'
      };
      return stageLabels[data.uiStage] || 'Working...';
    }
    return 'Working...';
  };

  const handleIframeError = () => {
    if (iframeRetries < 3) {
      // Retry with exponential backoff
      const delay = Math.pow(2, iframeRetries) * 1000; // 1s, 2s, 4s
      setTimeout(() => {
        setIframeRetries(prev => prev + 1);
        setIframeError(false);
      }, delay);
    } else {
      setIframeError(true);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="kloner-dots" aria-hidden="true"><span className="kloner-dot" /><span className="kloner-dot" /><span className="kloner-dot" /></div>
          <p className="text-gray-600">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (!previewData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-600">No preview data available</p>
        </div>
      </div>
    );
  }

  if (previewData.status === 'error') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Build Failed</h3>
            <p className="text-gray-600 mb-4">{previewData.error || 'An unknown error occurred'}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-[#e54f1a] transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (previewData.status === 'ready' && previewData.url) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-gray-200 bg-green-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-green-900">Preview Ready</h3>
              <p className="text-sm text-green-700">Your app is now running and ready to view</p>
            </div>
          </div>
        </div>
        <div className="flex-1 relative">
          {!iframeError ? (
            <iframe
              src={previewData.url}
              className="w-full h-full border-0"
              title="App Preview"
              onError={handleIframeError}
              key={iframeRetries} // Force re-render on retry
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4 max-w-md">
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto">
                  <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Connection Issue</h3>
                  <p className="text-gray-600 mb-4">Unable to load the preview. The app may still be starting up.</p>
                  <button
                    onClick={() => {
                      setIframeRetries(0);
                      setIframeError(false);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-[#e54f1a] transition-colors"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Building state
  const progress = Math.max(0, Math.min(100, previewData.uiProgress || 0));
  const isIndeterminate = previewData.uiProgress === undefined || previewData.uiProgress === null;

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md space-y-6">
        <div className="space-y-4">
          <div className="kloner-dots" aria-hidden="true"><span className="kloner-dot" /><span className="kloner-dot" /><span className="kloner-dot" /></div>

          <div className="space-y-2">
            <h3 className="text-xl font-medium text-gray-900">
              {previewData.uiTitle || 'Building your app...'}
            </h3>
            <p className="text-gray-600">
              {previewData.uiMessage || 'This may take a few minutes'}
            </p>
          </div>

          <div className="space-y-3">
            <div className="w-full bg-gray-200 rounded-full h-2">
              {isIndeterminate ? (
                <div className="h-2 bg-accent rounded-full animate-pulse" style={{ width: '60%' }}></div>
              ) : (
                <div
                  className="h-2 bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {getProgressLabel(previewData)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}