/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import {
    HTML_DISCOVERY_FALLBACK_GRACE_MS,
    HTML_DISCOVERY_MAX_ATTEMPTS,
    HTML_DISCOVERY_RETRY_MS,
    useHtmlDiscoveryFallbackGate,
} from "./htmlDiscoveryGate";

describe("useHtmlDiscoveryFallbackGate", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("keeps loading through the grace window before showing the fallback", async () => {
        const { result } = renderHook(() =>
            useHtmlDiscoveryFallbackGate({
                htmlPathCount: 0,
                isFilesStillHydrating: false,
            }),
        );

        expect(result.current.htmlDiscoveryAttempts).toBe(0);
        expect(result.current.isHtmlDiscoveryFallbackReady).toBe(false);

        for (let i = 0; i < HTML_DISCOVERY_MAX_ATTEMPTS; i += 1) {
            await act(async () => {
                await jest.advanceTimersByTimeAsync(HTML_DISCOVERY_RETRY_MS);
            });
        }

        expect(result.current.htmlDiscoveryAttempts).toBe(HTML_DISCOVERY_MAX_ATTEMPTS);
        expect(result.current.isHtmlDiscoveryFallbackReady).toBe(false);

        await act(async () => {
            await jest.advanceTimersByTimeAsync(HTML_DISCOVERY_FALLBACK_GRACE_MS - 1);
        });

        expect(result.current.isHtmlDiscoveryFallbackReady).toBe(false);

        await act(async () => {
            await jest.advanceTimersByTimeAsync(1);
        });

        expect(result.current.isHtmlDiscoveryFallbackReady).toBe(true);
    });

    it("resets the fallback gate when files become available", async () => {
        const { result, rerender } = renderHook(
            ({ htmlPathCount, isFilesStillHydrating }) =>
                useHtmlDiscoveryFallbackGate({ htmlPathCount, isFilesStillHydrating }),
            {
                initialProps: {
                    htmlPathCount: 0,
                    isFilesStillHydrating: false,
                },
            },
        );

        for (let i = 0; i < HTML_DISCOVERY_MAX_ATTEMPTS; i += 1) {
            await act(async () => {
                await jest.advanceTimersByTimeAsync(HTML_DISCOVERY_RETRY_MS);
            });
        }

        await act(async () => {
            await jest.advanceTimersByTimeAsync(HTML_DISCOVERY_FALLBACK_GRACE_MS);
        });

        expect(result.current.isHtmlDiscoveryFallbackReady).toBe(true);

        await act(async () => {
            rerender({
                htmlPathCount: 1,
                isFilesStillHydrating: false,
            });
        });

        expect(result.current.htmlDiscoveryAttempts).toBe(0);
        expect(result.current.isHtmlDiscoveryFallbackReady).toBe(false);
    });
});
