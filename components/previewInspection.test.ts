import { getPreviewInspectionOrigin, readPreviewInspectionResult, readPreviewRuntimeState } from './previewInspection';

describe('preview inspection messages', () => {
  const iframeWindow = {} as Window;
  const previewUrl = 'https://preview.kloner.app/preview/app-1';
  const result = {
    blank: false,
    title: 'Example page',
    bodyTextLength: 120,
    visibleElementCount: 7,
    blockingOverlay: {
      selector: '#blocking-white-layer',
      position: 'fixed',
      zIndex: 9999,
      coverage: 100,
      backgroundColor: 'rgb(255, 255, 255)',
    },
  };

  it('accepts a matching inspection response from the active iframe and origin', () => {
    expect(getPreviewInspectionOrigin(previewUrl)).toBe('https://preview.kloner.app');
    expect(readPreviewInspectionResult({
      source: iframeWindow,
      origin: 'https://preview.kloner.app',
      data: { type: 'kloner:preview-inspection-result', requestId: 'request-1', result },
    }, { iframeWindow, previewUrl, requestId: 'request-1' })).toEqual(result);
  });

  it('ignores messages from another window, origin, or request', () => {
    const event = {
      source: iframeWindow,
      origin: 'https://preview.kloner.app',
      data: { type: 'kloner:preview-inspection-result', requestId: 'request-1', result },
    };
    expect(readPreviewInspectionResult({ ...event, source: {} as Window }, { iframeWindow, previewUrl, requestId: 'request-1' })).toBeNull();
    expect(readPreviewInspectionResult({ ...event, origin: 'https://attacker.example' }, { iframeWindow, previewUrl, requestId: 'request-1' })).toBeNull();
    expect(readPreviewInspectionResult(event, { iframeWindow, previewUrl, requestId: 'request-2' })).toBeNull();
  });

  it('rejects malformed preview URLs and bounds data received from the page', () => {
    expect(getPreviewInspectionOrigin('javascript:alert(1)')).toBeNull();
    const inspected = readPreviewInspectionResult({
      source: iframeWindow,
      origin: 'https://preview.kloner.app',
      data: {
        type: 'kloner:preview-inspection-result',
        requestId: 'request-1',
        result: { ...result, blockingOverlay: { ...result.blockingOverlay, selector: 'x'.repeat(1000), coverage: 200 } },
      },
    }, { iframeWindow, previewUrl, requestId: 'request-1' });
    expect(inspected?.blockingOverlay?.selector).toHaveLength(180);
    expect(inspected?.blockingOverlay?.coverage).toBe(100);
  });

  it('accepts bounded runtime evidence only for the active project, preview, window and origin', () => {
    const timestamp = Date.now();
    const event = {
      source: iframeWindow, origin: 'https://preview.kloner.app',
      data: { type: 'kloner:preview-runtime-state', correlation: { app_id: 'app-1', preview_code: 'code-1' },
        runtime: { version: 1, navigationId: `${timestamp}-test`, startedAt: timestamp, capturedAt: timestamp,
          url: 'https://preview.kloner.app/?t=private-token', firstUsefulMs: 25, confirmedBlank: true,
          page: { blank: true, visibleElementCount: 0 },
          events: [{ kind: 'exception', message: 'Render failed', stack: 'at https://widgets.example/entry.js?secret=private-token:1:2' }],
          renders: [{ elapsedMs: 25, blank: false }, { elapsedMs: 1200, blank: true }], cookies: 'must not persist' } },
    };
    const expected = { iframeWindow, previewUrl, appId: 'app-1', code: 'code-1' };
    const runtime = readPreviewRuntimeState(event, expected);
    expect(runtime?.confirmedBlank).toBe(true);
    expect(runtime?.renders).toHaveLength(2);
    expect(runtime?.events[0].stack).toContain('widgets.example/entry.js');
    expect(runtime?.events[0].stack).toContain(':1:2');
    expect(JSON.stringify(runtime)).not.toMatch(/private-token|must not persist/);
    expect(readPreviewRuntimeState(event, { ...expected, appId: 'other' })).toBeNull();
    expect(readPreviewRuntimeState(event, { ...expected, code: 'old-code' })).toBeNull();
    expect(readPreviewRuntimeState({ ...event, source: {} as Window }, expected)).toBeNull();
    expect(readPreviewRuntimeState({ ...event, origin: 'https://attacker.example' }, expected)).toBeNull();
    expect(readPreviewRuntimeState({ ...event, data: { ...event.data, runtime: { ...event.data.runtime, capturedAt: timestamp - 180_000 } } }, expected)).toBeNull();
  });
});
