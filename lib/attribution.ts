// First-touch acquisition attribution for Kloner.
//
// Captures where a visitor first arrived from (landing page, referrer, UTM
// parameters) so signups and Stripe checkouts can be tied back to the page
// or campaign that produced them. Storage is consent-gated: nothing is
// written to localStorage or cookies until the visitor accepts optional
// cookies in the cookie banner (see components/AttributionCapture.tsx and
// components/CookieConsent.tsx). The cookie name is registered in
// NON_ESSENTIAL_COOKIE_NAMES so "Reject optional" / cookie settings clears it.

export const FIRST_TOUCH_LS_KEY = "kl_first_touch.v1";
export const FIRST_TOUCH_COOKIE = "kl_first_touch";

export type FirstTouchAttribution = {
    landingPath: string;
    referrer: string;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    utmTerm: string;
    utmContent: string;
    gclid: string;
    capturedAt: string; // ISO 8601, client clock
};

function cleanField(value: unknown, max: number): string {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, max);
}

export function parseFirstTouch(raw: unknown): FirstTouchAttribution | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    const capturedAt = cleanField(r.capturedAt, 64);
    if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) return null;

    const parsed: FirstTouchAttribution = {
        landingPath: cleanField(r.landingPath, 256),
        referrer: cleanField(r.referrer, 512),
        utmSource: cleanField(r.utmSource, 128),
        utmMedium: cleanField(r.utmMedium, 128),
        utmCampaign: cleanField(r.utmCampaign, 128),
        utmTerm: cleanField(r.utmTerm, 128),
        utmContent: cleanField(r.utmContent, 128),
        gclid: cleanField(r.gclid, 256),
        capturedAt,
    };

    const hasSignal =
        parsed.landingPath ||
        parsed.referrer ||
        parsed.utmSource ||
        parsed.utmMedium ||
        parsed.utmCampaign ||
        parsed.gclid;
    return hasSignal ? parsed : null;
}

export function readFirstTouchFromClient(): FirstTouchAttribution | null {
    if (typeof window === "undefined") return null;

    try {
        const match = document.cookie
            .split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith(`${FIRST_TOUCH_COOKIE}=`));
        if (match) {
            const decoded = decodeURIComponent(match.slice(FIRST_TOUCH_COOKIE.length + 1));
            const parsed = parseFirstTouch(JSON.parse(decoded));
            if (parsed) return parsed;
        }
    } catch {
        // ignore cookie parse failures
    }

    try {
        const raw = window.localStorage.getItem(FIRST_TOUCH_LS_KEY);
        if (raw) {
            const parsed = parseFirstTouch(JSON.parse(raw));
            if (parsed) return parsed;
        }
    } catch {
        // ignore storage parse failures
    }

    return null;
}

// Compact subset used for Stripe metadata (values must be <= 500 chars).
export function attributionToStripeMeta(
    attr: FirstTouchAttribution | null | undefined,
): Record<string, string> {
    if (!attr) return {};

    let referrerHost = "";
    if (attr.referrer) {
        try {
            referrerHost = new URL(attr.referrer).hostname;
        } catch {
            referrerHost = "";
        }
    }

    const source = attr.utmSource || referrerHost || (attr.gclid ? "google" : "");
    const meta: Record<string, string> = {};
    if (source) meta.acqSource = source.slice(0, 500);
    if (attr.utmMedium) meta.acqMedium = attr.utmMedium.slice(0, 500);
    else if (attr.gclid) meta.acqMedium = "cpc";
    if (attr.utmCampaign) meta.acqCampaign = attr.utmCampaign.slice(0, 500);
    if (attr.landingPath) meta.acqLanding = attr.landingPath.slice(0, 500);
    if (attr.referrer) meta.acqReferrer = attr.referrer.slice(0, 500);
    return meta;
}
