"use client";

import { ensureSessionAndCsrf } from "@/lib/auth-client";

export type KlonerSlackEvent = "signup" | "early_paywall_shown" | "early_paywall_started" | "early_paywall_closed";

type KlonerSlackEventDetails = {
    email?: string | null;
    name?: string | null;
    method?: string | null;
    trial?: boolean;
};

export async function sendKlonerSlackEvent(
    event: KlonerSlackEvent,
    details: KlonerSlackEventDetails = {},
): Promise<void> {
    const csrf = await ensureSessionAndCsrf();
    const response = await fetch("/api/private/slack-user-event", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(csrf ? { "x-csrf": csrf } : {}),
        },
        credentials: "same-origin",
        cache: "no-store",
        keepalive: event === "early_paywall_closed",
        body: JSON.stringify({ event, ...details }),
    });

    if (!response.ok) {
        throw new Error(`Slack event alert failed (${response.status})`);
    }
}
