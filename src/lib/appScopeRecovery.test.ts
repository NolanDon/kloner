import { isRecoverableAppScopeFailure, requestWithAppScopeRecovery } from "./appScopeRecovery";

describe("app scope recovery", () => {
    it("recognizes only missing or invalid scope 403s", () => {
        expect(isRecoverableAppScopeFailure({ status: 403, code: "MISSING_APP_SCOPE" })).toBe(true);
        expect(isRecoverableAppScopeFailure({ status: 403, code: "INVALID_APP_SCOPE" })).toBe(true);
        expect(isRecoverableAppScopeFailure({ status: 403, code: "FORBIDDEN" })).toBe(false);
        expect(isRecoverableAppScopeFailure({ status: 500, code: "MISSING_APP_SCOPE" })).toBe(false);
    });

    it("rebuilds scope and retries the same agent request once", async () => {
        const request = jest.fn()
            .mockResolvedValueOnce({ status: 403, code: "MISSING_APP_SCOPE", ok: false })
            .mockResolvedValueOnce({ status: 202, ok: true });
        const recovered = await requestWithAppScopeRecovery(request, jest.fn().mockResolvedValue(true));

        expect(recovered).toEqual({ result: { status: 202, ok: true }, attemptedRecovery: true, recovered: true, retried: true });
        expect(request).toHaveBeenCalledTimes(2);
    });

    it("does not retry when scope bootstrap fails", async () => {
        const request = jest.fn().mockResolvedValue({ status: 403, code: "INVALID_APP_SCOPE", ok: false });
        const recovered = await requestWithAppScopeRecovery(request, async () => false);

        expect(recovered).toMatchObject({ attemptedRecovery: true, recovered: false, retried: false });
        expect(request).toHaveBeenCalledTimes(1);
    });
});
