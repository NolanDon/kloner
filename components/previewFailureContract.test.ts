import {
  canShowPreviewFixWithAi,
  isReadyPreviewWithRuntimeWarning,
  limitEditorAgentPrompt,
  mapPreviewUserActionLabel,
  normalizePreviewGenerationContract,
  normalizePreviewFailureContract,
} from './previewFailureContract';

describe('previewFailureContract', () => {
  test('failure absent returns null and no Fix with AI', () => {
    expect(normalizePreviewFailureContract({ status: 'booting' })).toBeNull();
    expect(canShowPreviewFixWithAi(null)).toBe(false);
  });

  test('only internal preview repair requests can carry compact diagnostics beyond the user prompt limit', () => {
    const diagnosticPrompt = 'browser findings '.repeat(500);
    expect(limitEditorAgentPrompt(diagnosticPrompt).length).toBe(600);
    expect(limitEditorAgentPrompt(diagnosticPrompt, { previewRepair: true }).length).toBeLessThanOrEqual(12_000);
    expect(limitEditorAgentPrompt(diagnosticPrompt, { previewRepair: true })).toContain('browser findings');
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

  test('ready previews with unresolved startup findings show a warning and an AI fix', () => {
    const rawStatus = {
      status: 'ready',
      ready: true,
      startupRuntimeWarning: true,
      startupRuntimeWarningDetails: {
        message: 'The preview is open, but the page may still be blank',
        failure: {
          errorClass: 'white_screen',
          aiFixEligible: true,
          fixActionType: 'quick_fix_compile',
          userAction: 'refresh',
          confidence: 0.88,
          reason: 'startup findings remain',
          compileError: { quickFixEligible: true, summary: 'Preview may be blank', detail: '{"pageErrors":[]}', fingerprint: 'startup-1' },
        },
        diagnostics: { pageErrors: [] },
      },
    };
    const status = normalizePreviewGenerationContract(rawStatus);
    const failure = normalizePreviewFailureContract(rawStatus);
    expect(status?.status).toBe('warning');
    expect(status?.userMessage).toContain('page may still be blank');
    expect(status?.details).toBe('Browser findings are available for the AI repair');
    expect(isReadyPreviewWithRuntimeWarning(rawStatus)).toBe(true);
    expect(isReadyPreviewWithRuntimeWarning({ status: 'error', startupRuntimeWarningDetails: rawStatus.startupRuntimeWarningDetails })).toBe(false);
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
