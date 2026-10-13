export function classifyScanAlert({ code = "", message = "", statusCode = 502, backendStatus = "" }: { code?: string; message?: string; statusCode?: number; backendStatus?: string }) {
    const diagnostic = `${code} ${message}`;
    if (code === "EDITOR_ACCESS_REVOKED") {
        return { severity: "warning" as const, statusCode: 403, classification: "editor_access_rejected" };
    }
    if (code === "EDITOR_SESSION_REFRESH_FAILED") {
        return { severity: "error" as const, statusCode: 502, classification: "editor_session_refresh_failed" };
    }
    if (code === "EDITOR_NAVIGATION_TIMEOUT" || /Opening your editor timed out after 5 minutes/i.test(message)) {
        return { severity: "error" as const, statusCode: 504, classification: "editor_navigation_timeout" };
    }
    if (code === "EDITOR_NAVIGATION_FAILED") {
        return { severity: "error" as const, statusCode: 502, classification: "editor_navigation_failed" };
    }
    if (/UNSUPPORTED_SNAPSHOT_DOCUMENT|snapshot_v[23]_unsupported_document/i.test(diagnostic)) {
        return { severity: "warning" as const, statusCode: 422, classification: "unsupported_document" };
    }
    if (/DNS_RESOLUTION_FAILED|could not resolve|ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(diagnostic)) {
        return { severity: "warning" as const, statusCode: 502, classification: "target_dns_failure" };
    }
    if (/ARCHIVE_SIZE_LIMIT_REACHED|Please upgrade before scanning|too large for the Free plan/i.test(diagnostic)) {
        return { severity: "warning" as const, statusCode: 402, classification: "plan_restriction" };
    }
    if (/blocked_domain|Domain blocked for site cloning/i.test(diagnostic)) {
        return { severity: "warning" as const, statusCode: 403, classification: "domain_policy" };
    }
    if (/snapshot_v[23]_blocked|SNAPSHOT_CAPTURE_BLOCKED|WAF_CHALLENGE|site blocked the snapshot|\bBLOCKED\b|forbidden_page/i.test(diagnostic)) {
        return { severity: "warning" as const, statusCode: statusCode === 429 ? 429 : 403, classification: "upstream_block" };
    }
    if (/RATE_LIMITED|snapshot_v[23]_rate_limited/i.test(diagnostic)) {
        return { severity: "warning" as const, statusCode: 429, classification: "upstream_rate_limit" };
    }
    if (backendStatus === "ready" && /terminal error without a backend diagnostic/i.test(message)) {
        return { severity: "info" as const, statusCode: 200, classification: "stale_ui_state" };
    }
    if (/timed out|couldn't confirm.*\d+ minutes|snapshot_budget_exceeded/i.test(message)) {
        return { severity: "error" as const, statusCode: 504, classification: "timeout" };
    }
    if (code === "URL_CAPTURE_STALE" && !message.trim().match(/failed|exception/i)) {
        return { severity: "warning" as const, statusCode: 409, classification: "incomplete_scan" };
    }
    return { severity: statusCode >= 500 ? "critical" as const : "warning" as const, statusCode, classification: "unclassified" };
}
