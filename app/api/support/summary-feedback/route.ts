import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type FeedbackBody = {
    appId?: string;
    messageId?: string;
    summary?: string;
    feedback?: "up" | "down" | string;
    context?: {
        query?: string;
        currentPath?: string | null;
        requestedAt?: number;
        search?: {
            request?: Record<string, unknown> | null;
            response?: Record<string, unknown> | null;
        } | null;
        jobId?: string | null;
        requestId?: string | null;
    } | null;
};

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value ?? null, null, 2);
    } catch {
        return "[unserializable]";
    }
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

            // Upvotes are recorded client-side only; no support email required.
            if (feedback === "up") {
                return NextResponse.json({ ok: true, sent: false });
            }

            const appId = String(body.appId || "").trim();
            const messageId = String(body.messageId || "").trim();
            const summary = String(body.summary || "").trim();
            const context = body.context || null;

            try {
                const resend = getResend();
                const to = "support@kloner.app";
                const from = process.env.SUPPORT_ESCALATION_FROM || "hello@kloner.app";
                const whenIso = new Date().toISOString();

                const subject = `Kloner summary feedback (thumbs down)${appId ? ` · ${appId}` : ""}`;
                const text = [
                    "Summary feedback: thumbs down",
                    `Time: ${whenIso}`,
                    `User ID: ${uid || "unknown"}`,
                    `App ID: ${appId || "unknown"}`,
                    `Message ID: ${messageId || "unknown"}`,
                    "",
                    "Summary response:",
                    summary || "(empty)",
                    "",
                    "Inquiry context:",
                    `Query: ${String(context?.query || "") || "(unknown)"}`,
                    `Current path: ${String(context?.currentPath || "") || "(none)"}`,
                    `Requested at: ${context?.requestedAt ? new Date(context.requestedAt).toISOString() : "unknown"}`,
                    `Job ID: ${String(context?.jobId || "") || "unknown"}`,
                    `Request ID: ${String(context?.requestId || "") || "unknown"}`,
                    "",
                    "Search request:",
                    safeJson(context?.search?.request || null),
                    "",
                    "Search response:",
                    safeJson(context?.search?.response || null),
                ].join("\n");

                const html = `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
<h2>Summary feedback: thumbs down</h2>
<p><strong>Time:</strong> ${whenIso}</p>
<p><strong>User ID:</strong> ${uid || "unknown"}</p>
<p><strong>App ID:</strong> ${appId || "unknown"}</p>
<p><strong>Message ID:</strong> ${messageId || "unknown"}</p>
<h3>Summary response</h3>
<pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e5e7eb;padding:10px;border-radius:8px">${(summary || "(empty)").replace(/[<>]/g, "")}</pre>
<h3>Inquiry context</h3>
<pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e5e7eb;padding:10px;border-radius:8px">${safeJson({
                    query: context?.query || null,
                    currentPath: context?.currentPath || null,
                    requestedAt: context?.requestedAt || null,
                    jobId: context?.jobId || null,
                    requestId: context?.requestId || null,
                    search: context?.search || null,
                }).replace(/[<>]/g, "")}</pre>
</div>`;

                await resend.emails.send({
                    from,
                    to,
                    subject,
                    text,
                    html,
                });

                return NextResponse.json({ ok: true, sent: true });
            } catch (error) {
                console.error("[support/summary-feedback] failed", error);
                return NextResponse.json({ ok: false, error: "Failed to send summary feedback." }, { status: 500 });
            }
        },
        { csrf: true, methods: ["POST"] },
    );
}
