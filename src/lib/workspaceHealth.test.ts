import { isWorkspacePreviewConnectionFailure, workspacePreviewConnectionMessage } from './workspaceHealth';
test.each(['HEALTH_CHECK_RUNTIME_FAILED', 'HEALTH_CHECK_FAST_RUNTIME_FAILED', 'RESTART_TIMEOUT'])('%s is a preview connection failure, not a compiler error', code => {
    expect(isWorkspacePreviewConnectionFailure(code)).toBe(true);
});
test('a failing build remains eligible for a code repair', () => expect(isWorkspacePreviewConnectionFailure('HEALTH_CHECK_FAILED')).toBe(false));
test('preview outages explain saved work without asking the user to ask AI', () => {
    expect(workspacePreviewConnectionMessage()).toContain('changes are saved');
    expect(workspacePreviewConnectionMessage()).not.toMatch(/AI|code problem/);
});
