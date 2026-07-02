import {
  canShowPreviewFixWithAi,
  mapPreviewUserActionLabel,
  normalizePreviewFailureContract,
} from './previewFailureContract';

describe('previewFailureContract', () => {
  test('failure absent returns null and no Fix with AI', () => {
    expect(normalizePreviewFailureContract({ status: 'booting' })).toBeNull();
    expect(canShowPreviewFixWithAi(null)).toBe(false);
  });

  test('aiFixEligible false never shows Fix with AI', () => {
    const failure = normalizePreviewFailureContract({
      failure: {
        errorClass: 'compile_error',
        aiFixEligible: false,
        fixActionType: 'quick_fix_compile',
        userAction: 'refresh',
      },
    });

    expect(failure).not.toBeNull();
    expect(canShowPreviewFixWithAi(failure)).toBe(false);
  });

  test('compile_error + eligible + quick_fix_compile shows Fix with AI', () => {
    const failure = normalizePreviewFailureContract({
      failure: {
        errorClass: 'compile_error',
        aiFixEligible: true,
        fixActionType: 'quick_fix_compile',
        userAction: 'rebuild',
      },
    });

    expect(failure).not.toBeNull();
    expect(canShowPreviewFixWithAi(failure)).toBe(true);
  });

  test('dependency_error + eligible + quick_fix_compile is eligible', () => {
    const failure = normalizePreviewFailureContract({
      failure: {
        errorClass: 'dependency_error',
        aiFixEligible: true,
        fixActionType: 'quick_fix_compile',
        userAction: 'refresh',
      },
    });

    expect(failure).not.toBeNull();
    expect(canShowPreviewFixWithAi(failure)).toBe(true);
  });

  test('infra classes never show Fix with AI', () => {
    const classes = [
      'machine_timeout',
      'proxy_unreachable',
      'network_unreachable',
      'runtime_crash',
      'app_unreachable',
      'rate_limited',
      'preview_replaced_or_deleted',
      'unknown',
    ];

    for (const errorClass of classes) {
      const failure = normalizePreviewFailureContract({
        failure: {
          errorClass,
          aiFixEligible: true,
          fixActionType: 'quick_fix_compile',
          userAction: 'refresh',
        },
      });
      expect(failure).not.toBeNull();
      expect(canShowPreviewFixWithAi(failure)).toBe(false);
    }
  });

  test('userAction label mapping', () => {
    expect(mapPreviewUserActionLabel('refresh')).toBe('Refresh');
    expect(mapPreviewUserActionLabel('rebuild')).toBe('Start fresh');
    expect(mapPreviewUserActionLabel('reconnect')).toBe('Reconnect');
    expect(mapPreviewUserActionLabel('wait_and_retry')).toBe('Retry');
    expect(mapPreviewUserActionLabel('contact_support')).toBe('Contact support');
  });
});
