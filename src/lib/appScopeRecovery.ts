export type ScopeAwareResult = { status: number; code?: string | null };

export function isRecoverableAppScopeFailure(result: ScopeAwareResult): boolean {
    const code = String(result.code || "").toUpperCase();
    return result.status === 403 && (code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE");
}

export async function requestWithAppScopeRecovery<T extends ScopeAwareResult>(
    request: () => Promise<T>,
    bootstrap: () => Promise<boolean>,
): Promise<{ result: T; attemptedRecovery: boolean; recovered: boolean; retried: boolean }> {
    let result = await request();
    if (!isRecoverableAppScopeFailure(result)) {
        return { result, attemptedRecovery: false, recovered: false, retried: false };
    }
    const recovered = await bootstrap().catch(() => false);
    if (!recovered) return { result, attemptedRecovery: true, recovered: false, retried: false };
    result = await request();
    return { result, attemptedRecovery: true, recovered: true, retried: true };
}
