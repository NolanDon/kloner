"use client";

import { useEffect } from "react";
import { trackMixpanel } from "@/lib/mixpanel";

function extractPropsFromDataset(dataset: DOMStringMap): Record<string, unknown> {
    const props: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(dataset)) {
        if (!key.startsWith("mpProp")) continue;
        if (typeof value !== "string") continue;

        const raw = key.slice("mpProp".length);
        if (!raw) continue;
        const propKey = raw.charAt(0).toLowerCase() + raw.slice(1);
        props[propKey] = value;
    }

    const maybeJson = dataset.mpProps;
    if (typeof maybeJson === "string" && maybeJson.trim().length > 0) {
        try {
            const parsed = JSON.parse(maybeJson);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                Object.assign(props, parsed);
            }
        } catch {
            // ignore invalid JSON
        }
    }

    return props;
}

export default function MixpanelAutocapture() {
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            const el = target?.closest?.("[data-mp-event]") as HTMLElement | null;
            if (!el) return;

            const eventName = el.dataset.mpEvent;
            if (!eventName) return;

            const props = extractPropsFromDataset(el.dataset);
            trackMixpanel(eventName, {
                ...props,
                tag: el.tagName?.toLowerCase?.() || undefined,
            });
        };

        document.addEventListener("click", handler, true);
        return () => document.removeEventListener("click", handler, true);
    }, []);

    return null;
}
