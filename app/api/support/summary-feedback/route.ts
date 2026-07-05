import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { buildEditPlanSlackDiagnosticText } from "@/src/lib/editPlanFeedbackDiagnostic";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type FeedbackBody = {
    messageId?: string;
    summary?: string;
    feedback?: "up" | "down" | string;
    reportCode?: string | null;
    jobId?: string | null;
    requestId?: string | null;
    summaryText?: string | null;
    reportOutcome?: unknown;
};

function normalizeString(value: unknown): string {
    return String(value || "").trim();
}

function getSlackWebhookUrl(): string {
    return (process.env.SLACK_ERROR_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || "").trim();
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const body = (await req.json().catch(() => ({}))) as FeedbackBody;
            const feedback = String(body.feedback || "").trim().toLowerCase();
            if (feedback !== "up" && feedback !== "down") {
                return NextResponse.json({ ok: false, error: "Invalid feedback." }, { status: 400 });
            }

            // Upvotes remain a local UX signal and do not need Slack escalation.
            if (feedback === "up") {
                return NextResponse.json({ ok: true, sent: false, posted: false });
            }

            const messageId = normalizeString(body.messageId);
            const summary = normalizeString(body.summary);

            const webhookUrl = getSlackWebhookUrl();
            if (!webhookUrl) {
                return NextResponse.json({ ok: false, error: "SLACK_ERROR_WEBHOOK_URL env not set" }, { status: 500 });
            }

            const text = buildEditPlanSlackDiagnosticText({
                messageId,
                feedback: "down",
                reportCode: normalizeString(body.reportCode || null) || null,
                jobId: normalizeString(body.jobId || null) || null,
                requestId: normalizeString(body.requestId || null) || null,
                summaryText: normalizeString(body.summaryText || null) || null,
                reportOutcome: body.reportOutcome ?? null,
                summary,
                userId: uid || null,
            });

            try {
                const response = await fetch(webhookUrl, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        text,
                        username: "Kloner Feedback",
                        icon_emoji: ":speech_balloon:",
                        unfurl_links: false,
                        unfurl_media: false,
                    }),
                });

                if (!response.ok) {
                    const responseText = await response.text().catch(() => "");
                    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}${responseText ? ` - ${responseText}` : ""}`);
                }

                console.info("[support/summary-feedback] posted_to_slack", {
                    messageId: messageId || null,
                    reportCode: normalizeString(body.reportCode || null) || null,
                    jobId: normalizeString(body.jobId || null) || null,
                    requestId: normalizeString(body.requestId || null) || null,
                });

                return NextResponse.json({ ok: true, sent: true, posted: true });
            } catch (error) {
                console.error("[support/summary-feedback] failed", error);
                return NextResponse.json({ ok: false, error: "Failed to send summary feedback." }, { status: 500 });
            }
        },
        { csrf: true, methods: ["POST"] },
    );
}
