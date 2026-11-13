import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const ALLOWED_EVENTS = new Set([
    "signup",
    "early_paywall_shown",
    "stripe_checkout_redirecting",
    "stripe_trial_option_disabled",
    "early_paywall_closed",
    "stripe_checkout_cancelled",
    "editor_deploy_paywall_shown",
    "editor_download_paywall_shown",
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
            const context = body.context === "editor_deploy" || body.context === "editor_download" || body.context === "dashboard_deploy" || body.context === "dashboard_scan"
                ? body.context
                : "dashboard_scan";
            const contextLabel = context === "editor_deploy"
                ? "Editor · Deploy"
                : context === "editor_download"
                    ? "Editor · Code download"
                    : context === "dashboard_deploy"
                        ? "Dashboard · App deploy"
                    : "Dashboard · Scan";
            const billingState = safeText(body.billingState, "").toLowerCase();
            const billingLabel = billingState === "trialing"
                ? "Trial"
                : billingState === "free"
                    ? "Free plan"
                    : ["pro", "agency", "enterprise", "active"].includes(billingState)
                        ? "Paid plan"
                        : "";
            const trialReason = [
                "prior_subscription",
                "country_restricted",
                "eligibility_check_failed",
                "trials_disabled",
                "paid_option_selected",
            ].includes(safeText(body.trialReason, ""))
                ? safeText(body.trialReason, "")
                : "";
            const trialReasonLabel = trialReason === "prior_subscription"
                ? "prior subscription history"
                : trialReason === "country_restricted"
                    ? "regional eligibility"
                    : trialReason === "eligibility_check_failed"
                        ? "eligibility check could not be confirmed"
                        : trialReason === "trials_disabled"
                            ? "trial offer unavailable"
                            : trialReason === "paid_option_selected"
                                ? "trial option switched off"
                                : "";
            const checkoutPlanLabel = body.trial === true
                ? "7-day free trial"
                : body.requestedTrial === false
                    ? "Paid plan (trial option switched off)"
                    : trialReasonLabel
                        ? `Paid plan (trial unavailable: ${trialReasonLabel})`
                        : "Paid plan";
            const eventText = event === "signup"
                ? `:sparkles: *New signup* · ${email}${name ? ` · ${name}` : ""}${method ? ` · ${method}` : ""}`
                : event === "early_paywall_shown"
                    ? `:lock: *Early paywall shown* · ${email} · ${contextLabel}${billingLabel ? ` · ${billingLabel}` : ""}`
                    : event === "stripe_checkout_redirecting"
                        ? `:credit_card: *Stripe checkout redirecting* · ${email} · ${contextLabel} · ${checkoutPlanLabel}`
                        : event === "stripe_trial_option_disabled"
                            ? `:credit_card: *Free trial switched off* · ${email} · ${contextLabel} · Paid plan selected`
                            : event === "early_paywall_closed"
                                ? `:x: *Paywall closed* · ${email} · ${contextLabel} · Scan canceled`
                                : event === "stripe_checkout_cancelled"
                                    ? `:no_entry_sign: *Stripe checkout canceled* · ${email} · ${contextLabel}`
                                    : event === "editor_deploy_paywall_shown"
                                        ? `:lock: *Editor deploy paywall shown* · ${email} · ${billingLabel || "Trial"}`
                                        : event === "editor_download_paywall_shown"
                                            ? `:lock: *Editor code download paywall shown* · ${email} · ${billingLabel || "Free plan"}`
                                            : `:no_entry_sign: *Stripe checkout canceled* · ${email} · ${contextLabel}`;

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
