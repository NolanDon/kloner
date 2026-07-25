"use client";

import { useCookieConsent } from "@/components/CookieConsent";

export default function CookieSettingsLink() {
    const { openCookieSettings } = useCookieConsent();

    return (
        <button
            type="button"
            onClick={openCookieSettings}
            className="text-neutral-700 hover:text-neutral-900"
        >
            Cookie settings
        </button>
    );
}
