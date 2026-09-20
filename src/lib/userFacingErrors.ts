export type UserFacingUrlErrorInput = {
    status?: number | null;
    code?: unknown;
    reason?: unknown;
    message?: unknown;
};

function normalizedText(...values: unknown[]): string {
    return values
        .map((value) => (typeof value === "string" ? value : String(value || "")))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .join(" ");
}

/** Backend messages are classification signals only, never UI copy. */
export function getUserFacingUrlErrorMessage(input: UserFacingUrlErrorInput): string {
    const status = typeof input.status === "number" ? input.status : 0;
    const code = normalizedText(input.code);
    const text = normalizedText(input.code, input.reason, input.message);

    if (
        code === "monthly_snapshot_limit" ||
        code === "snapshot_credit_limit" ||
        text.includes("monthly snapshot limit") ||
        text.includes("screenshot credits")
    ) {
        return "You’ve reached your monthly scan limit. Upgrade your plan or try again when your credits reset.";
    }

    if (
        code === "blocked_url" ||
        text.includes("domain blocked") ||
        text.includes("blocked for site cloning") ||
        text.includes("site blocked") ||
        text.includes("blacklist") ||
        text.includes("not allowed")
    ) {
        return "This website can’t be captured because access is restricted. Try a public page without a login, captcha, or geo-blocking.";
    }

    if (
        status === 422 ||
        code === "cross_domain_redirect" ||
        text.includes("cross-domain redirect") ||
        text.includes("redirected to a different domain")
    ) {
        return "This URL redirected to another website. Paste the final destination URL and try again.";
    }

    if (
        code.includes("too_large") ||
        code.includes("payload") ||
        text.includes("too large") ||
        text.includes("exceeds the")
    ) {
        return "This website is too large to capture in one scan. Try a smaller page or a more specific URL.";
    }

    if (status === 401 || code === "unauthorized" || code === "auth_error") {
        return "Your session expired. Refresh the page and try again.";
    }

    if (
        status === 502 ||
        status === 503 ||
        status === 504 ||
        text.includes("failed to fetch") ||
        text.includes("backend fetch") ||
        text.includes("proxy failed") ||
        text.includes("network") ||
        text.includes("timeout") ||
        text.includes("timed out")
    ) {
        return "We couldn’t reach this website right now. Check that it opens publicly, then try again in a moment.";
    }

    if (status === 400 || code.includes("invalid") || code.includes("validation")) {
        return "Please check the URL and make sure it is a complete public web address, then try again.";
    }

    return "We couldn’t finish capturing this website. Please try again in a moment.";
}
