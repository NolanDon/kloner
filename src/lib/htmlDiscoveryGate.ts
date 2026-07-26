"use client";

import { useEffect, useState } from "react";

export const HTML_DISCOVERY_MAX_ATTEMPTS = 4;
export const HTML_DISCOVERY_RETRY_MS = 700;
export const HTML_DISCOVERY_FALLBACK_GRACE_MS = 5000;

type HtmlDiscoveryGateArgs = {
    htmlPathCount: number;
    isFilesStillHydrating: boolean;
};

/**
 * Keep showing the loading state while the preview editor is still looking for
 * a valid HTML entrypoint, even after the retry loop has exhausted.
 *
 * The extra grace period prevents a brief empty-state flash when the project
 * files are still settling into place.
 */
export function useHtmlDiscoveryFallbackGate({
    htmlPathCount,
    isFilesStillHydrating,
}: HtmlDiscoveryGateArgs) {
    const [htmlDiscoveryAttempts, setHtmlDiscoveryAttempts] = useState(0);
    const [htmlDiscoveryGraceElapsed, setHtmlDiscoveryGraceElapsed] = useState(false);

    useEffect(() => {
        if (htmlPathCount > 0 || isFilesStillHydrating) {
            setHtmlDiscoveryAttempts(0);
            setHtmlDiscoveryGraceElapsed(false);
            return;
        }

        if (htmlDiscoveryAttempts >= HTML_DISCOVERY_MAX_ATTEMPTS) {
            return;
        }

        const timeout = window.setTimeout(() => {
            setHtmlDiscoveryAttempts((attempt) =>
                Math.min(attempt + 1, HTML_DISCOVERY_MAX_ATTEMPTS),
            );
        }, HTML_DISCOVERY_RETRY_MS);

        return () => window.clearTimeout(timeout);
    }, [htmlDiscoveryAttempts, htmlPathCount, isFilesStillHydrating]);

    useEffect(() => {
        if (htmlPathCount > 0 || isFilesStillHydrating) {
            setHtmlDiscoveryGraceElapsed(false);
            return;
        }

        if (htmlDiscoveryAttempts < HTML_DISCOVERY_MAX_ATTEMPTS) {
            setHtmlDiscoveryGraceElapsed(false);
            return;
        }

        setHtmlDiscoveryGraceElapsed(false);
        const timeout = window.setTimeout(() => {
            setHtmlDiscoveryGraceElapsed(true);
        }, HTML_DISCOVERY_FALLBACK_GRACE_MS);

        return () => window.clearTimeout(timeout);
    }, [htmlDiscoveryAttempts, htmlPathCount, isFilesStillHydrating]);

    const isHtmlDiscoveryFallbackReady =
        !isFilesStillHydrating &&
        htmlPathCount === 0 &&
        htmlDiscoveryAttempts >= HTML_DISCOVERY_MAX_ATTEMPTS &&
        htmlDiscoveryGraceElapsed;

    return {
        htmlDiscoveryAttempts,
        isHtmlDiscoveryFallbackReady,
        htmlDiscoveryGraceElapsed,
    };
}
