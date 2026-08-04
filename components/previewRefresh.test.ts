import { requestPreviewForceFresh } from "./previewRefresh";

describe("requestPreviewForceFresh", () => {
    const originalWindow = (globalThis as any).window;
    const originalCustomEvent = (globalThis as any).CustomEvent;

    afterEach(() => {
        (globalThis as any).window = originalWindow;
        (globalThis as any).CustomEvent = originalCustomEvent;
        jest.restoreAllMocks();
    });

    test("does not dispatch the fresh-preview event for restore flows", () => {
        const dispatchEvent = jest.fn();
        (globalThis as any).window = { dispatchEvent };

        const result = requestPreviewForceFresh({
            appId: "app_123",
            reason: "restore-point-revert",
        });

        expect(result).toBe(false);
        expect(dispatchEvent).not.toHaveBeenCalled();
    });

    test("dispatches the fresh-preview event for non-restore flows", () => {
        const dispatchEvent = jest.fn();
        class FakeCustomEvent {
            type: string;
            detail: unknown;

            constructor(type: string, init?: CustomEventInit) {
                this.type = type;
                this.detail = init?.detail;
            }
        }

        (globalThis as any).window = { dispatchEvent };
        (globalThis as any).CustomEvent = FakeCustomEvent as any;

        const result = requestPreviewForceFresh({
            appId: "app_123",
            reason: "generation-ready",
        });

        expect(result).toBe(true);
        expect(dispatchEvent).toHaveBeenCalledTimes(1);

        const event = dispatchEvent.mock.calls[0]?.[0] as FakeCustomEvent;
        expect(event.type).toBe("kloner:preview-force-fresh");
        expect(event.detail).toEqual({ appId: "app_123", reason: "generation-ready" });
    });
});
