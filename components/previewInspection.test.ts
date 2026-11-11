import { getPreviewInspectionOrigin, readPreviewInspectionResult } from './previewInspection';

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
});
