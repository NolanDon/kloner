"use client";

import { ensureSessionAndCsrf } from "@/lib/auth-client";

export type KlonerSlackEvent =
    | "signup"
    | "early_paywall_shown"
    | "stripe_checkout_redirecting"
    | "early_paywall_closed"
    | "stripe_checkout_cancelled"
    | "editor_deploy_paywall_shown"
    | "editor_download_paywall_shown";

type KlonerSlackEventDetails = {
    email?: string | null;
    name?: string | null;
    method?: string | null;
    trial?: boolean;
    context?: "dashboard_scan" | "dashboard_deploy" | "editor_deploy" | "editor_download";
    billingState?: string | null;
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
        keepalive: event === "early_paywall_closed" || event === "stripe_checkout_cancelled" || event === "editor_deploy_paywall_shown" || event === "editor_download_paywall_shown",
        body: JSON.stringify({ event, ...details }),
    });

    if (!response.ok) {
        throw new Error(`Slack event alert failed (${response.status})`);
    }
}
