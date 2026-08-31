import type { NextRequest } from "next/server";

// Trusted-country overrides requested by product policy. The hold list itself
// is operationally configured and empty by default.
export const EARLY_PAYWALL_BYPASS_COUNTRIES = new Set(["US", "CA", "GB", "CH", "DE", "AU"]);

function parseCountryList(value: string | undefined): Set<string> {
    return new Set(String(value || "").split(/[\s,]+/).map((country) => country.trim().toUpperCase()).filter((country) => /^[A-Z]{2}$/.test(country)));
}

export function getRequestCountry(req: NextRequest): string | null {
    const getHeader = (name: string) => {
        const headers: any = (req as any)?.headers;
        return typeof headers?.get === "function" ? headers.get(name) : "";
    };
    const country = [
        getHeader("x-vercel-ip-country"),
        getHeader("cf-ipcountry"),
    ].find((value) => value && /^[A-Za-z]{2}$/.test(value.trim()));
    return country ? country.trim().toUpperCase() : null;
}

export function shouldRequireEarlyGenerationPaywall(req: NextRequest): {
    required: boolean;
    country: string | null;
    reason: "configured_country_hold" | null;
} {
    const country = getRequestCountry(req);
    if (!country || EARLY_PAYWALL_BYPASS_COUNTRIES.has(country)) {
        return { required: false, country, reason: null };
    }
    const required = parseCountryList(process.env.EARLY_PAYWALL_COUNTRIES).has(country);
    return { required, country, reason: required ? "configured_country_hold" : null };
}
