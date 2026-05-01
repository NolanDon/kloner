import {
  buildPreviewAlertKey,
  classifyBackendSignal,
  classifyPreviewPresentationState,
  getPollBackoffMs,
  isTrustedBrowserPreviewUrl,
  parsePreviewTimeoutMs,
  shouldDedupeAlert,
} from './previewAlertPolicy';

describe('previewAlertPolicy', () => {
  test('parses timeout env with fallback', () => {
    expect(parsePreviewTimeoutMs(undefined, 30000)).toBe(30000);
    expect(parsePreviewTimeoutMs('45000', 30000)).toBe(45000);
    expect(parsePreviewTimeoutMs('100', 30000)).toBe(5000);
  });

  test('classifies recoverable backend states', () => {
    const signal = classifyBackendSignal({ status: 'starting', uiStage: 'booting' });
    expect(signal.recoverable).toBe(true);
    expect(signal.hardFailure).toBe(false);
  });

  test('keeps booting with machineId and url pending', () => {
    const state = classifyPreviewPresentationState({
      status: 'booting',
      uiStage: 'booting',
      ready: false,
      machineId: 'machine-123',
      url: 'https://preview.example.test/preview/code?t=token',
    }, {
      previewUrl: '/api/webcontainer/app-1/proxy/',
      iframeLoaded: false,
      hmrWsStatus: 'unknown',
    });

    expect(state.recoverable).toBe(true);
    expect(state.terminal).toBe(false);
    expect(state.shouldKeepPolling).toBe(true);
    expect(state.shouldShowLivePreview).toBe(false);
    expect(state.shouldShowLoadingShell).toBe(true);
  });

  test('moves forward when attachable is true before ready', () => {
    const state = classifyPreviewPresentationState({
      status: 'starting',
      uiStage: 'starting',
      ready: false,
      attachable: true,
      machineId: 'machine-123',
      url: 'https://preview.example.test/preview/code?t=token',
    }, {
      previewUrl: '/api/webcontainer/app-1/proxy/',
      iframeLoaded: false,
      hmrWsStatus: 'unknown',
    });

    expect(state.attachable).toBe(true);
    expect(state.recoverable).toBe(true);
    expect(state.terminal).toBe(false);
    expect(state.shouldKeepPolling).toBe(false);
    expect(state.shouldShowLivePreview).toBe(true);
    expect(state.shouldShowLoadingShell).toBe(false);
  });

  test('treats restart pending as recoverable pending state', () => {
    const state = classifyPreviewPresentationState({
      status: 'starting',
      uiStage: 'restarting',
      restartPending: true,
      retryable: true,
      outcome: 'restart_pending',
      retryAfterSeconds: 12,
      ready: false,
      machineId: 'machine-123',
      url: 'https://preview.example.test/preview/code?t=token',
    }, {
      previewUrl: '/api/webcontainer/app-1/proxy/',
      iframeLoaded: false,
      hmrWsStatus: 'unknown',
    });

    expect(state.restartPending).toBe(true);
    expect(state.retryable).toBe(true);
    expect(state.recoverable).toBe(true);
    expect(state.terminal).toBe(false);
    expect(state.shouldKeepPolling).toBe(true);
  });

  test('does not terminalize when failure classification is absent', () => {
    const state = classifyPreviewPresentationState({
      status: 'error',
      uiStage: 'machine_timeout',
      ready: false,
      retryable: false,
      restartPending: false,
    }, {
      previewUrl: '/api/webcontainer/app-1/proxy/',
      iframeLoaded: false,
      hmrWsStatus: 'unknown',
    });

    expect(state.terminal).toBe(false);
    expect(state.shouldShowTerminalError).toBe(false);
    expect(state.shouldKeepPolling).toBe(true);
  });

  test('rejects raw fly and private browser preview urls', () => {
    expect(isTrustedBrowserPreviewUrl('https://tracksite-hub.fly.dev/preview/code?t=token')).toBe(false);
    expect(isTrustedBrowserPreviewUrl('https://10.0.0.12/preview/code?t=token')).toBe(false);
    expect(isTrustedBrowserPreviewUrl('/api/webcontainer/app-1/proxy/')).toBe(true);
  });

  test('treats proxy_unreachable_auto as recoverable', () => {
    const signal = classifyBackendSignal({ status: 'error', uiStage: 'proxy_unreachable_auto' });
    expect(signal.recoverable).toBe(true);
    expect(signal.hardFailure).toBe(false);
  });

  test('classifies hard failure timeout reason', () => {
    const signal = classifyBackendSignal({
      status: 'starting',
      uiStage: 'booting',
      debug: { timeoutReason: 'machine_disk_io_error', requestId: 'req-1', jobId: 'job-1' },
    });
    expect(signal.hardFailure).toBe(true);
    expect(signal.timeoutReason).toBe('machine_disk_io_error');
    expect(signal.requestId).toBe('req-1');
    expect(signal.jobId).toBe('job-1');
  });

  test('builds stable dedupe key', () => {
    expect(buildPreviewAlertKey({ userId: 'u1', appId: 'a1', code: 'c1', reason: 'preview_slow_start_warn' }))
      .toBe('u1:a1:c1:preview_slow_start_warn');
  });

  test('dedupe TTL behavior', () => {
    const cache = { key: 1000 };
    expect(shouldDedupeAlert(cache, 'key', 1000 + 1000, 5000)).toBe(true);
    expect(shouldDedupeAlert(cache, 'key', 1000 + 6000, 5000)).toBe(false);
  });

  test('poll backoff is exponential and capped', () => {
    expect(getPollBackoffMs(1)).toBe(1000);
    expect(getPollBackoffMs(2)).toBe(2000);
    expect(getPollBackoffMs(3)).toBe(4000);
    expect(getPollBackoffMs(4)).toBe(8000);
    expect(getPollBackoffMs(8)).toBe(8000);
  });
});
