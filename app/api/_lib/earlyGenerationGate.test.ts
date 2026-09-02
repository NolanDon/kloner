import {
    getRequestCountry,
    shouldRequireEarlyGenerationPaywall,
} from "./earlyGenerationGate";

function requestWithHeaders(headers: Record<string, string>) {
    return { headers: new Headers(headers) } as any;
}

describe("early generation paywall gate", () => {
    const original = process.env.EARLY_PAYWALL_COUNTRIES;

    afterEach(() => {
        if (original === undefined) delete process.env.EARLY_PAYWALL_COUNTRIES;
        else process.env.EARLY_PAYWALL_COUNTRIES = original;
    });

    it("holds only configured countries", () => {
        process.env.EARLY_PAYWALL_COUNTRIES = "BD, IN PK";

        expect(shouldRequireEarlyGenerationPaywall(requestWithHeaders({ "cf-ipcountry": "BD" }))).toEqual({
            required: true,
            country: "BD",
            reason: "configured_country_hold",
        });
        for (const country of ["IN", "PK"]) {
            expect(shouldRequireEarlyGenerationPaywall(requestWithHeaders({ "cf-ipcountry": country }))).toEqual({
                required: true,
                country,
                reason: "configured_country_hold",
            });
        }
        expect(shouldRequireEarlyGenerationPaywall(requestWithHeaders({ "cf-ipcountry": "FR" }))).toEqual({
            required: false,
            country: "FR",
            reason: null,
        });
    });

    it("always bypasses the trusted-country overrides", () => {
        process.env.EARLY_PAYWALL_COUNTRIES = "US CA GB CH DE AU";

        for (const country of ["US", "CA", "GB", "CH", "DE", "AU"]) {
            expect(shouldRequireEarlyGenerationPaywall(requestWithHeaders({ "x-vercel-ip-country": country })).required).toBe(false);
        }
    });

    it("supports the deployed proxy headers and is disabled by default", () => {
        delete process.env.EARLY_PAYWALL_COUNTRIES;
        const request = requestWithHeaders({ "cf-ipcountry": "IN" });
        expect(getRequestCountry(request)).toBe("IN");
        expect(shouldRequireEarlyGenerationPaywall(request).required).toBe(false);
    });
});
