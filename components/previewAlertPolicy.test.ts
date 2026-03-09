import {
  buildPreviewAlertKey,
  classifyBackendSignal,
  getPollBackoffMs,
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
