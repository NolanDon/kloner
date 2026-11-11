import { compactPreviewBrowserFindings, getPreviewInspectionOrigin, readPreviewInspectionResult } from './previewInspection';

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
    runtimeDiagnostics: [],
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

  it('passes bounded actionable browser failures to the agent without leaking request query values', () => {
    const inspected = readPreviewInspectionResult({
      source: iframeWindow,
      origin: 'https://preview.kloner.app',
      data: {
        type: 'kloner:preview-inspection-result',
        requestId: 'request-1',
        correlation: { app_id: 'app-1' },
        result: {
          ...result,
          blank: true,
          runtimeDiagnostics: [
            {
              kind: 'http_error',
              resourceType: 'fetch',
              method: 'GET',
              status: 404,
              url: 'https://backend.leadconnectorhq.com/funnels/page/data?stepId=secret-value&paymentV2=true',
              stack: 'at load (https://preview.kloner.app/assets/page.js?token=private:40:2)',
            },
            ...Array.from({ length: 30 }, () => ({ kind: 'page_error', message: 'x'.repeat(2000) })),
          ],
        },
      },
    }, { iframeWindow, previewUrl, requestId: 'request-1', appId: 'app-1' });
    expect(inspected?.runtimeDiagnostics).toHaveLength(20);
    expect(inspected?.runtimeDiagnostics[0]).toMatchObject({
      kind: 'http_error',
      status: 404,
      url: 'https://backend.leadconnectorhq.com/funnels/page/data',
    });
    expect(inspected?.runtimeDiagnostics[0].stack).toContain('https://preview.kloner.app/assets/page.js:40:2');
    expect(JSON.stringify(inspected)).not.toMatch(/secret-value|private/);
    expect(readPreviewInspectionResult({
      source: iframeWindow,
      origin: 'https://preview.kloner.app',
      data: { type: 'kloner:preview-inspection-result', requestId: 'request-1', correlation: { app_id: 'other-app' }, result },
    }, { iframeWindow, previewUrl, requestId: 'request-1', appId: 'app-1' })).toBeNull();
  });

  it('compacts startup and iframe findings into a source-traceable repair payload', () => {
    const findings = compactPreviewBrowserFindings(JSON.stringify({
      reason: 'blank preview',
      currentStatusData: {
        startupRuntimeWarningDetails: {
          message: 'blank preview',
          diagnostics: {
            navigation: { status: 200, path: 'https://preview.kloner.app/join-v2?token=private' },
            page: { bodyVisible: false, visibleElementCount: 0, readyState: 'complete', largeOpaqueElements: [] },
            httpErrors: [{ status: 404, resourceType: 'fetch', url: 'https://preview.kloner.app/cdn-cgi/rum?secret=private' }],
            blockedExternalRequestDetails: [{ url: 'https://backend.leadconnectorhq.com/funnels/page/data?stepId=private', resourceType: 'fetch', method: 'GET', frameUrl: 'https://preview.kloner.app/join-v2' }],
          },
        },
      },
      runtimeDiagnostics: [{ kind: 'http_error', status: 404, resourceType: 'fetch', url: 'https://backend.leadconnectorhq.com/funnels/page/data?stepId=private', stack: 'at load (https://preview.kloner.app/assets/page.js?token=private:40:2)' }],
    }));
    expect(findings?.navigation).toMatchObject({ status: 200, path: 'https://preview.kloner.app/join-v2' });
    expect(findings?.httpErrors).toEqual([{ status: 404, resourceType: 'fetch', url: 'https://preview.kloner.app/cdn-cgi/rum' }]);
    expect(findings?.blockedExternalRequests).toEqual([{
      url: 'https://backend.leadconnectorhq.com/funnels/page/data',
      resourceType: 'fetch',
      method: 'GET',
      frameUrl: 'https://preview.kloner.app/join-v2',
    }]);
    expect(JSON.stringify(findings)).not.toMatch(/private/);
    expect(JSON.stringify(findings).length).toBeLessThan(5000);
  });
});
