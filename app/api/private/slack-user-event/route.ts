import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const ALLOWED_EVENTS = new Set([
    "signup",
    "early_paywall_shown",
    "early_paywall_started",
    "early_paywall_closed",
    "stripe_checkout_cancelled",
]);

function safeText(value: unknown, fallback = ""): string {
    return String(value ?? fallback).replace(/[\r\n<>|]/g, " ").trim().slice(0, 120);
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const body = await req.json().catch(() => ({}));
            const event = safeText(body.event);
            if (!ALLOWED_EVENTS.has(event)) {
                return NextResponse.json({ ok: false, error: "Unsupported event." }, { status: 400 });
            }

            const webhookUrl = (process.env.SLACK_ERROR_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || "").trim();
            if (!webhookUrl) {
                return NextResponse.json({ ok: false, error: "Slack notifications are not configured." }, { status: 503 });
            }

            const email = safeText(body.email, "user");
            const method = safeText(body.method, "");
            const name = safeText(body.name, "");
            const eventText = event === "signup"
                ? `:sparkles: *New signup* · ${email}${name ? ` · ${name}` : ""}${method ? ` · ${method}` : ""}`
                : event === "early_paywall_shown"
                    ? `:lock: *Early paywall shown* · ${email}`
                    : event === "early_paywall_started"
                        ? `:white_check_mark: *Paywall started* · ${email} · ${body.trial === false ? "Paid" : "Trial"}`
                        : event === "early_paywall_closed"
                            ? `:x: *Paywall closed* · ${email} · Scan canceled`
                            : `:no_entry_sign: *Stripe checkout canceled* · ${email}`;

            try {
                const response = await fetch(webhookUrl, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        text: eventText,
                        username: "Kloner",
                        icon_emoji: ":large_orange_circle:",
                        unfurl_links: false,
                        unfurl_media: false,
                    }),
                });
                if (!response.ok) {
                    console.error("[slack-user-event] delivery failed", { status: response.status, uid, event });
                    return NextResponse.json({ ok: false, error: "Slack alert delivery failed." }, { status: 502 });
                }
                return NextResponse.json({ ok: true, sent: true }, { headers: { "Cache-Control": "no-store" } });
            } catch (error) {
                console.error("[slack-user-event] request failed", { uid, event, error });
                return NextResponse.json({ ok: false, error: "Slack alert delivery failed." }, { status: 502 });
            }
        },
        { methods: ["POST"], csrf: true },
    );
}
