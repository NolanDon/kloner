// Authorization codes and CSRF state belong in the flow, never in diagnostics.
export function redactDiagnosticUrl(raw: string): string {
    try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
            if (/^(code|state|token|access_token|id_token|refresh_token|client_secret|api[_-]?key|secret|password|signature|t)$/i.test(key)) {
                url.searchParams.set(key, "REDACTED");
            }
        }
        return url.toString();
    } catch {
        // Invalid URLs provide no reliable safe query boundary.
        return raw.split(/[?#]/, 1)[0] || "invalid-url";
    }
}
