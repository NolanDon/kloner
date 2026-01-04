// app/api/ai-edit/route.ts
//
// GEMINI-ONLY VERSION
// - Removes ALL OpenAI usage (moderation, responses, image generation).
// - Keeps: credits reserve/refund/commit, history writes, abuse alerting via Resend,
//          placeholder asset stripping, create_page prompt builder, suggestions fetch.
// - Safety handling: relies on Gemini safety. If Gemini blocks/overloads, credits are refunded.
// - Observability: logs Gemini status + message + requestId; 429 is returned as 429 (not masked as 503).
//
// PATCH (renderId feed issue / remixed renders):
// - Accept renderId from multiple possible keys (renderId, render_id, renderDocId, id, docId, klonerRenderId).
// - GET also accepts renderId via renderId/id/renderDocId query params.
// - Error payload returns which keys were seen to make client-side fixes obvious.

import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { monthlyLimitFor, type UserTier } from "@/src/lib/credits";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { randomUUID, createHash } from "crypto";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================
   Gemini init (ONLY)
   ========================= */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// Choose a stable model you actually have access to.
// If you were using "gemini-3-pro-preview" and it causes instability, switch to a stable tier.
// Keep your original string if you need it.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

/* =========================
   Types
   ========================= */

interface AiEditRequestBody {
    renderId: string;
    html: string;
    prompt?: string;
    originalPrompt?: string;
    mode?: "code" | "imagery";
    action?: "edit_block" | "create_page";
    pageId?: string;
    slug?: string;
    userPrompt?: string;
    requestId?: string;

    // PATCH: tolerate alternate client payload keys
    render_id?: string;
    renderDocId?: string;
    docId?: string;
    id?: string;
    klonerRenderId?: string;
}

interface AiEditModelResult {
    ok: boolean;
    afterHtml: string;
    summary: string;
    errorCode?: string;
    errorStatus?: number;
    userError?: string;
}

/* =========================
   Limits
   ========================= */

const MAX_HTML_CHARS = 8_000;
const MAX_USER_PROMPT_CHARS = 1_000;
const MAX_MODEL_PROMPT_CHARS = 2_200;

/* =========================
   Abuse alert configuration
   ========================= */

const ABUSE_SUPPORT_TO = "support@kloner.com";
const ABUSE_THRESHOLD = 5; // triggers in window
const ABUSE_WINDOW_MINUTES = 30; // rolling window
const ABUSE_ALERT_COOLDOWN_MINUTES = 120; // do not email more often than this

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function safeSnippet(input: string, max = 220) {
    const t = String(input || "")
        .replace(/\s+/g, " ")
        .trim();
    if (!t) return "";
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + "…";
}

function hashIp(ip: string) {
    return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

function nowMs() {
    return Date.now();
}

function buildAbuseAlertHtml(payload: {
    uid: string;
    email?: string | null;
    ip?: string | null;
    ua?: string | null;
    reason: string;
    requestId: string;
    promptSnippet?: string;
    countInWindow: number;
    windowMinutes: number;
    lastEventAtMs: number;
}) {
    const accent = "#f55f2a";
    const dark = "#111827";
    const muted = "#6b7280";

    const {
        uid,
        email,
        ip,
        ua,
        reason,
        requestId,
        promptSnippet,
        countInWindow,
        windowMinutes,
        lastEventAtMs,
    } = payload;

    const when = new Date(lastEventAtMs).toISOString();

    return `
<!doctype html>
<html lang="en">
  <head><meta charSet="utf-8" /><title>Kloner Abuse Alert</title></head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:720px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #fee2d5;">
            <tr>
              <td style="padding:18px 24px;border-bottom:1px solid #fee2d5;background:${accent};">
                <div style="display:flex;align-items:center;gap:12px;">
                  <div style="height:32px;width:32px;border-radius:999px;background:#ffffff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:${accent};">
                    K
                  </div>
                  <div>
                    <div style="font-size:16px;font-weight:700;color:#ffffff;">Kloner Abuse Alert</div>
                    <div style="font-size:12px;color:#ffe7dc;margin-top:2px;">Repeated safety-triggering requests detected</div>
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 26px 10px 26px;">
                <div style="font-size:13px;color:${dark};line-height:1.6;">
                  <div><strong>UID:</strong> ${uid}</div>
                  <div><strong>Email:</strong> ${email || "-"}</div>
                  <div><strong>IP:</strong> ${ip || "-"}</div>
                  <div style="margin-top:10px;"><strong>Reason:</strong> ${reason}</div>
                  <div><strong>Request ID:</strong> ${requestId}</div>
                  <div><strong>Count in last ${windowMinutes} min:</strong> ${countInWindow}</div>
                  <div><strong>Last event:</strong> ${when}</div>
                </div>

                ${promptSnippet
            ? `<div style="margin-top:14px;padding:12px 12px;border:1px solid #fee2d5;border-radius:12px;background:#fff7f3;">
                         <div style="font-size:12px;color:${muted};font-weight:700;margin-bottom:6px;">Prompt snippet (redacted)</div>
                         <div style="font-size:12px;color:${dark};line-height:1.6;white-space:pre-wrap;">${promptSnippet
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</div>
                       </div>`
            : ""
        }

                ${ua
            ? `<div style="margin-top:14px;font-size:12px;color:${muted};line-height:1.6;">
                         <div style="font-weight:700;color:${dark};margin-bottom:4px;">User-Agent</div>
                         <div style="white-space:pre-wrap;">${safeSnippet(ua, 260)
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</div>
                       </div>`
            : ""
        }
              </td>
            </tr>

            <tr>
              <td style="padding:14px 26px;border-top:1px solid #fee2d5;background:#fff7f3;">
                <div style="font-size:11px;color:#9ca3af;">
                  This is an automated security alert from Kloner.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

function buildAbuseAlertText(payload: {
    uid: string;
    email?: string | null;
    ip?: string | null;
    ua?: string | null;
    reason: string;
    requestId: string;
    promptSnippet?: string;
    countInWindow: number;
    windowMinutes: number;
    lastEventAtMs: number;
}) {
    const when = new Date(payload.lastEventAtMs).toISOString();
    return (
        `Kloner Abuse Alert\n\n` +
        `UID: ${payload.uid}\n` +
        `Email: ${payload.email || "-"}\n` +
        `IP: ${payload.ip || "-"}\n` +
        `Reason: ${payload.reason}\n` +
        `Request ID: ${payload.requestId}\n` +
        `Count in last ${payload.windowMinutes} min: ${payload.countInWindow}\n` +
        `Last event: ${when}\n\n` +
        (payload.promptSnippet ? `Prompt snippet (redacted): ${payload.promptSnippet}\n\n` : "") +
        (payload.ua ? `User-Agent: ${safeSnippet(payload.ua, 260)}\n` : "")
    );
}

async function recordAbuseAndMaybeAlert(opts: {
    db: any;
    uid: string;
    userEmail?: string | null;
    reason: string;
    requestId: string;
    promptSnippet?: string;
    ip?: string | null;
    ua?: string | null;
}) {
    const { db, uid, userEmail, reason, requestId, promptSnippet, ip, ua } = opts;

    const from = process.env.ABUSE_ALERT_FROM || "hello@kloner.app";
    const windowMs = ABUSE_WINDOW_MINUTES * 60_000;
    const cooldownMs = ABUSE_ALERT_COOLDOWN_MINUTES * 60_000;
    const ts = nowMs();

    const abuseRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("security")
        .doc("abuse_ai_edit");

    const ipHash = ip ? hashIp(ip) : null;
    const abuseIpRef = ipHash ? db.collection("security_abuse").doc(`ip_${ipHash}`) : null;

    let shouldEmail = false;
    let countInWindow = 0;

    try {
        await db.runTransaction(async (tx: any) => {
            const snap = await tx.get(abuseRef);
            const data = snap.exists ? (snap.data() as any) : {};

            const events: any[] = Array.isArray(data.events) ? data.events : [];
            const recent = events.filter((e) => typeof e?.ts === "number" && ts - e.ts <= windowMs);

            const newEvent = {
                ts,
                reason: String(reason || "unknown"),
                requestId: String(requestId || ""),
                prompt: safeSnippet(promptSnippet || "", 220),
                ip: ip ? safeSnippet(ip, 64) : null,
            };

            const nextRecent = [newEvent, ...recent].slice(0, 30);
            countInWindow = nextRecent.length;

            const lastAlertAtMs = typeof data.lastAlertAtMs === "number" ? data.lastAlertAtMs : 0;
            const cooldownOk = ts - lastAlertAtMs >= cooldownMs;
            const thresholdHit = countInWindow >= ABUSE_THRESHOLD;

            shouldEmail = Boolean(thresholdHit && cooldownOk);

            tx.set(
                abuseRef,
                {
                    events: nextRecent,
                    countInWindow,
                    windowMinutes: ABUSE_WINDOW_MINUTES,
                    lastEventAtMs: ts,
                    lastReason: newEvent.reason,
                    lastRequestId: newEvent.requestId,
                    lastAlertAtMs: shouldEmail ? ts : lastAlertAtMs,
                    lastAlertRequestId: shouldEmail ? requestId : data.lastAlertRequestId || null,
                    updatedAt: new Date(ts),
                },
                { merge: true }
            );

            if (abuseIpRef) {
                const ipSnap = await tx.get(abuseIpRef);
                const ipData = ipSnap.exists ? (ipSnap.data() as any) : {};
                const ipEvents: any[] = Array.isArray(ipData.events) ? ipData.events : [];
                const ipRecent = ipEvents.filter((e) => typeof e?.ts === "number" && ts - e.ts <= windowMs);
                const ipNext = [{ ts, uid, reason, requestId }, ...ipRecent].slice(0, 50);

                tx.set(
                    abuseIpRef,
                    {
                        ipHash,
                        events: ipNext,
                        countInWindow: ipNext.length,
                        lastEventAtMs: ts,
                        updatedAt: new Date(ts),
                    },
                    { merge: true }
                );
            }
        });
    } catch (e) {
        console.error("[ai-edit][abuse] failed recording abuse", e);
        return;
    }

    if (!shouldEmail) return;

    try {
        const resend = getResend();

        const html = buildAbuseAlertHtml({
            uid,
            email: userEmail || null,
            ip: ip || null,
            ua: ua || null,
            reason,
            requestId,
            promptSnippet: safeSnippet(promptSnippet || "", 220),
            countInWindow,
            windowMinutes: ABUSE_WINDOW_MINUTES,
            lastEventAtMs: ts,
        });

        const text = buildAbuseAlertText({
            uid,
            email: userEmail || null,
            ip: ip || null,
            ua: ua || null,
            reason,
            requestId,
            promptSnippet: safeSnippet(promptSnippet || "", 220),
            countInWindow,
            windowMinutes: ABUSE_WINDOW_MINUTES,
            lastEventAtMs: ts,
        });

        const result = await resend.emails.send({
            from,
            to: ABUSE_SUPPORT_TO,
            subject: `Kloner Abuse Alert: AI edit safety triggers (${countInWindow}/${ABUSE_THRESHOLD})`,
            text,
            html,
        });

        if ("error" in result && (result as any).error) {
            console.error("[ai-edit][abuse] Resend error:", (result as any).error);
        }
    } catch (e) {
        console.error("[ai-edit][abuse] failed sending alert email", e);
    }
}

/* =========================
   Existing route logic
   ========================= */

function nextPeriodEndUtc(now: Date) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const firstNext = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
    return new Date(firstNext.getTime() - 1);
}

function creditEventRef(db: any, uid: string, requestId: string) {
    return db.collection("kloner_users").doc(uid).collection("credit_events").doc(requestId);
}

/* =========================
   PATCH: renderId normalization
   ========================= */

function normalizeRenderIdFromBody(body: Partial<AiEditRequestBody> | any): string {
    const candidates = [
        body?.renderId,
        body?.render_id,
        body?.renderDocId,
        body?.docId,
        body?.id,
        body?.klonerRenderId,
    ];

    for (const c of candidates) {
        const v = typeof c === "string" ? c.trim() : "";
        if (v) return v;
    }

    return "";
}

function renderIdDebugKeys(body: any) {
    const keys = ["renderId", "render_id", "renderDocId", "docId", "id", "klonerRenderId"];
    const seen: Record<string, any> = {};
    for (const k of keys) {
        if (k in (body || {})) {
            const v = (body as any)[k];
            seen[k] = typeof v === "string" ? safeSnippet(v, 80) : v;
        }
    }
    return seen;
}

async function reserveAiEditCreditsInline(opts: {
    db: any;
    uid: string;
    tier: UserTier;
    cost: number;
    now: Date;
    requestId: string;
    debug?: {
        renderId?: string;
        action?: "edit_block" | "create_page";
        mode?: "code" | "imagery";
        pageId?: string;
        slug?: string;
        userPrompt?: string;
        ipHash?: string | null;
        ua?: string | null;
    };
}): Promise<
    | { ok: true; remaining: number | null; limit: number | null; periodEnd: Date | null; alreadyReservedOrCommitted?: boolean }
    | { ok: false; status: number; message: string; remaining: number; limit: number; periodEnd: Date | null }
> {
    const { db, uid, tier, cost, now, requestId, debug } = opts;

    const limit = monthlyLimitFor(tier, "edit");
    if (!limit) {
        return { ok: true, remaining: null, limit: 0, periodEnd: null };
    }

    const userRef = db.collection("kloner_users").doc(uid);
    const evtRef = creditEventRef(db, uid, requestId);

    const debugPayload = debug
        ? {
            renderId: debug.renderId || null,
            action: debug.action || null,
            mode: debug.mode || null,
            pageId: debug.pageId || null,
            slug: debug.slug || null,
            question: safeSnippet(debug.userPrompt || "", 420) || null,
            ipHash: debug.ipHash || null,
            ua: debug.ua ? safeSnippet(debug.ua, 180) : null,
        }
        : null;

    return await db.runTransaction(async (tx: any) => {
        const evtSnap = await tx.get(evtRef);
        if (evtSnap.exists) {
            const evt = evtSnap.data() as any;
            const status = String(evt?.status || "");
            if (status === "reserved" || status === "committed" || status === "refunded") {
                const userSnap = await tx.get(userRef);
                const data = userSnap.exists ? (userSnap.data() as any) : {};
                const bucket = data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};

                const rawEnd = bucket.periodEnd;
                let periodEndDate: Date | null = null;
                if (rawEnd && typeof rawEnd.toDate === "function") periodEndDate = rawEnd.toDate() as Date;
                else if (rawEnd instanceof Date) periodEndDate = rawEnd;

                const active = periodEndDate !== null && now < periodEndDate;
                const existingRemaining = typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

                const endDate = active ? (periodEndDate as Date) : nextPeriodEndUtc(now);
                const startRemaining = active && existingRemaining !== null ? existingRemaining : limit;

                if (debugPayload) {
                    tx.set(evtRef, { debug: debugPayload, updatedAt: now }, { merge: true });
                }

                return { ok: true, remaining: startRemaining, limit, periodEnd: endDate, alreadyReservedOrCommitted: true };
            }
        }

        const snap = await tx.get(userRef);
        const data = snap.exists ? (snap.data() as any) : {};
        const bucket = data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};

        const rawEnd = bucket.periodEnd;
        let periodEndDate: Date | null = null;
        if (rawEnd && typeof rawEnd.toDate === "function") periodEndDate = rawEnd.toDate() as Date;
        else if (rawEnd instanceof Date) periodEndDate = rawEnd;

        const active = periodEndDate !== null && now < periodEndDate;
        const existingRemaining = typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

        const endDate = active ? (periodEndDate as Date) : nextPeriodEndUtc(now);
        const startRemaining = active && existingRemaining !== null ? existingRemaining : limit;

        if (startRemaining < cost) {
            tx.set(
                userRef,
                {
                    "credits.aiEdits": {
                        remaining: Math.max(startRemaining, 0),
                        monthlyLimit: limit,
                        periodEnd: endDate,
                    },
                },
                { merge: true }
            );

            tx.set(
                evtRef,
                {
                    feature: "ai_edit",
                    status: "blocked",
                    reason: "insufficient_credits",
                    cost,
                    tier,
                    createdAt: now,
                    createdAtMs: now.getTime(),
                    debug: debugPayload,
                },
                { merge: true }
            );

            return {
                ok: false,
                status: 402,
                message: "You have used all AI edit credits for this month.",
                remaining: Math.max(startRemaining, 0),
                limit,
                periodEnd: endDate,
            };
        }

        const newRemaining = Math.max(startRemaining - cost, 0);

        tx.set(
            userRef,
            {
                "credits.aiEdits": {
                    remaining: newRemaining,
                    monthlyLimit: limit,
                    periodEnd: endDate,
                },
            },
            { merge: true }
        );

        tx.create(evtRef, {
            feature: "ai_edit",
            status: "reserved",
            cost,
            tier,
            createdAt: now,
            createdAtMs: now.getTime(),
            debug: debugPayload,
        });

        return { ok: true, remaining: newRemaining, limit, periodEnd: endDate };
    });
}

async function refundAiEditCreditsInline(opts: {
    db: any;
    uid: string;
    tier: UserTier;
    cost: number;
    now: Date;
    requestId: string;
    reason: string;
    errorCode?: string;
    errorStatus?: number;
}) {
    const { db, uid, tier, cost, now, requestId, reason, errorCode, errorStatus } = opts;

    const limit = monthlyLimitFor(tier, "edit");
    if (!limit) return;

    const userRef = db.collection("kloner_users").doc(uid);
    const evtRef = creditEventRef(db, uid, requestId);

    await db.runTransaction(async (tx: any) => {
        const evtSnap = await tx.get(evtRef);
        if (!evtSnap.exists) return;

        const evt = evtSnap.data() as any;
        const status = String(evt?.status || "");
        if (status !== "reserved") return;

        const userSnap = await tx.get(userRef);
        const data = userSnap.exists ? (userSnap.data() as any) : {};
        const bucket = data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};

        const rawEnd = bucket.periodEnd;
        let periodEndDate: Date | null = null;
        if (rawEnd && typeof rawEnd.toDate === "function") periodEndDate = rawEnd.toDate() as Date;
        else if (rawEnd instanceof Date) periodEndDate = rawEnd;

        const active = periodEndDate !== null && now < periodEndDate;
        const endDate = active ? (periodEndDate as Date) : nextPeriodEndUtc(now);

        const existingRemaining = typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

        const startRemaining = active && existingRemaining !== null ? existingRemaining : limit;
        const newRemaining = Math.min(startRemaining + cost, limit);

        tx.set(
            userRef,
            {
                "credits.aiEdits": {
                    remaining: newRemaining,
                    monthlyLimit: limit,
                    periodEnd: endDate,
                },
            },
            { merge: true }
        );

        tx.set(
            evtRef,
            {
                status: "refunded",
                refundedAt: now,
                refundedAtMs: now.getTime(),
                refundReason: reason,
                errorCode: errorCode || null,
                errorStatus: typeof errorStatus === "number" ? errorStatus : null,
            },
            { merge: true }
        );
    });
}

async function commitAiEditCreditsInline(opts: { db: any; uid: string; requestId: string; now: Date; summary?: string }) {
    const { db, uid, requestId, now, summary } = opts;
    const evtRef = creditEventRef(db, uid, requestId);

    try {
        await db.runTransaction(async (tx: any) => {
            const snap = await tx.get(evtRef);
            if (!snap.exists) return;
            const evt = snap.data() as any;
            const status = String(evt?.status || "");
            if (status === "committed") return;
            if (status !== "reserved") return;

            tx.set(
                evtRef,
                {
                    status: "committed",
                    committedAt: now,
                    committedAtMs: now.getTime(),
                    summarySnippet: summary ? safeSnippet(summary, 220) : null,
                },
                { merge: true }
            );
        });
    } catch (e) {
        console.error("[ai-edit] failed to commit credit event", e);
    }
}

async function ensureAiEditBucketInline(opts: {
    db: any;
    uid: string;
    tier: UserTier;
    now: Date;
}): Promise<{ remaining: number | null; limit: number | null; periodEnd: Date | null }> {
    const { db, uid, tier, now } = opts;

    const limit = monthlyLimitFor(tier, "edit");
    if (!limit) return { remaining: null, limit: 0, periodEnd: null };

    const userRef = db.collection("kloner_users").doc(uid);

    return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(userRef);
        const data = snap.exists ? (snap.data() as any) : {};
        const bucket = data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};

        const rawEnd = bucket.periodEnd;
        let periodEndDate: Date | null = null;
        if (rawEnd && typeof rawEnd.toDate === "function") periodEndDate = rawEnd.toDate() as Date;
        else if (rawEnd instanceof Date) periodEndDate = rawEnd;

        const active = periodEndDate !== null && now < periodEndDate;
        const existingRemaining = typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

        const endDate = active ? (periodEndDate as Date) : nextPeriodEndUtc(now);

        if (active && existingRemaining !== null) {
            return { remaining: existingRemaining, limit, periodEnd: endDate };
        }

        tx.set(
            userRef,
            {
                "credits.aiEdits": {
                    remaining: limit,
                    monthlyLimit: limit,
                    periodEnd: endDate,
                },
            },
            { merge: true }
        );

        return { remaining: limit, limit, periodEnd: endDate };
    });
}

/* =========================
   Page creation prompt logic (unchanged)
   ========================= */

function inferPageIntentFromSlug(slug: string): {
    kind: "about" | "contact" | "pricing" | "services" | "faq" | "blog" | "features" | "landing" | "generic";
    title: string;
    hints: string[];
} {
    const s = String(slug || "").toLowerCase().trim();
    const parts = s.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "new page";
    const title = last
        .split("-")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

    const pick = (kind: any, hints: string[]) => ({ kind, title, hints });

    if (/(^|\/)(about|about-us|team|company|story|mission)(\/|$)/.test(s)) {
        return pick("about", ["mission + values", "team or founder section", "social proof / testimonials", "cta section"]);
    }
    if (/(^|\/)(contact|support|help)(\/|$)/.test(s)) {
        return pick("contact", ["contact methods", "form area (fields only, no <form> submission logic)", "faq snippets", "cta section"]);
    }
    if (/(^|\/)(pricing|plans|fees)(\/|$)/.test(s)) {
        return pick("pricing", ["tier cards (3 tiers)", "feature comparison bullets (not a table)", "faq section", "cta section"]);
    }
    if (/(^|\/)(services|service)(\/|$)/.test(s)) {
        return pick("services", ["service list with short blurbs", "process steps", "case study highlight", "cta section"]);
    }
    if (/(^|\/)(faq|faqs)(\/|$)/.test(s)) {
        return pick("faq", ["accordion-like blocks", "cta section"]);
    }
    if (/(^|\/)(blog|articles|posts)(\/|$)/.test(s)) {
        return pick("blog", ["blog grid placeholder", "categories strip", "cta section"]);
    }
    if (/(^|\/)(features|product|platform)(\/|$)/.test(s)) {
        return pick("features", ["hero + value prop", "feature sections (3+)", "cta section"]);
    }
    if (/(^|\/)(home|landing|start)(\/|$)/.test(s)) {
        return pick("landing", ["hero", "benefits", "social proof", "cta"]);
    }
    return pick("generic", ["hero section", "2–4 content sections based on inferred topic", "cta section"]);
}

function isVagueUserPrompt(p: string): boolean {
    const t = String(p || "").trim();
    if (!t) return true;
    if (t.length < 18) return true;
    const low = t.toLowerCase();
    const vagueSignals = ["make a page", "new page", "basic page", "nice page", "simple page", "make it look good", "something about"];
    return vagueSignals.some((s) => low.includes(s));
}

function buildCreatePagePrompt(args: {
    pageId: string;
    slug: string;
    userPrompt: string;
}): { modelPrompt: string; userPromptForStorage: string } {
    const { pageId, slug, userPrompt } = args;

    const inferred = inferPageIntentFromSlug(slug);
    const title = inferred.title || "New page";
    const vague = isVagueUserPrompt(userPrompt);

    const intentLine = vague
        ? `No detailed brief was provided. Infer a complete multi-section layout from the page topic ("${title}") and standard expectations for a "${inferred.kind}" page.`
        : `User brief: ${userPrompt}`;

    const themeSnapshot = `
SITE THEME SNAPSHOT (AUTHORITATIVE — DO NOT GUESS):
- Background: full-bleed space / nebula imagery with purple + blue tones
- Overall background is DARK and image-based
- Primary text color: white (#ffffff)
- Secondary text: rgba(255,255,255,0.7)
- Headings: uppercase, wide letter-spacing, minimal, academic tone
- Accent elements: thin white lines, low opacity dividers
- Cards: translucent or outlined, NEVER solid dark panels
- Do NOT invent dark gradient panels
- Do NOT introduce a new design system
- Match the homepage visual language exactly
`;

    const contrastRule = `
CONTRAST RULE (NON-NEGOTIABLE):
- All readable text MUST have strong contrast against its background
- If background is dark or image-based, text MUST be white or near-white
- Black or dark gray text on dark backgrounds is FORBIDDEN
- If contrast is uncertain, add subtle overlays or outlines
`;

    const sectionsLine =
        `Minimum output: at least 4 distinct sections (hero + 2+ content sections + CTA). ` +
        `Avoid single-panel or hero-only layouts.`;

    const routingConsistencyLine =
        `ROUTING RULES (STRICT): ` +
        `You are editing ONLY this page container: <main class="page-root" data-route="${pageId}">. ` +
        `Do not change data-route.`;

    const structureLine =
        `Create the layout INSIDE the provided <main class="page-root" data-route="${pageId}"> block only. ` +
        `Return ONLY the updated HTML for this block.`;

    const globalLayoutLine = `Do NOT add or modify global header or footer elements.`;
    const privacyLine = `Do not print the route path anywhere in visible content.`;

    const cssRules =
        `If you include <style>, scope selectors under main.page-root[data-route="${pageId}"] only. ` +
        `Never target body, html, :root, header, or footer.`;

    const sectionHints = inferred.hints?.length ? `Suggested sections: ${inferred.hints.join(", ")}.` : "";

    const modelPrompt = [
        `Create a brand new page layout inside the provided <main class="page-root" data-route="${pageId}"> block.`,
        themeSnapshot,
        contrastRule,
        routingConsistencyLine,
        intentLine,
        sectionHints,
        sectionsLine,
        globalLayoutLine,
        privacyLine,
        cssRules,
        structureLine,
    ]
        .filter(Boolean)
        .join(" ");

    return {
        modelPrompt: modelPrompt.slice(0, MAX_MODEL_PROMPT_CHARS),
        userPromptForStorage: userPrompt || "",
    };
}

/* =========================
   HTML helpers
   ========================= */

function trimHtmlForModel(html: string): string {
    if (html.length <= MAX_HTML_CHARS) return html;

    const lower = html.toLowerCase();
    const headEnd = lower.indexOf("</head>");

    if (headEnd === -1) {
        return html.slice(0, MAX_HTML_CHARS);
    }

    const head = html.slice(0, headEnd + "</head>".length);
    const rest = html.slice(headEnd + "</head>".length);

    const remainingBudget = MAX_HTML_CHARS - head.length;
    if (remainingBudget <= 0) {
        return head.slice(0, MAX_HTML_CHARS);
    }

    return head + rest.slice(0, remainingBudget);
}

/**
 * Hard kill-switch for placeholder assets.
 * Strategy:
 * - Replace any example.com src/href with inert values.
 * - Wipe srcset containing example.com.
 * - Remove any <link ... href="https://example.com/..."> entirely.
 * - Kill CSS url(https://example.com/...) to "none".
 */
function stripExampleDotComAssets(html: string) {
    if (!html) return html;

    let out = String(html);

    out = out.replace(/<link\b[^>]*\bhref\s*=\s*(?:"|')https?:\/\/example\.com\/[^"']+(?:"|')[^>]*>/gi, "");
    out = out.replace(/(\ssrc\s*=\s*["'])https?:\/\/example\.com\/[^"']+(["'])/gi, '$1data:,$2');
    out = out.replace(/(\ssrc\s*=\s*)https?:\/\/example\.com\/[^\s>]+/gi, "$1data:,");
    out = out.replace(/(\shref\s*=\s*["'])https?:\/\/example\.com\/[^"']+(["'])/gi, '$1#$2');
    out = out.replace(/(\shref\s*=\s*)https?:\/\/example\.com\/[^\s>]+/gi, "$1#");
    out = out.replace(/(\ssrcset\s*=\s*["'])[^"']*example\.com[^"']*(["'])/gi, "$1$2");
    out = out.replace(/(\ssrcset\s*=\s*)[^\s>]*example\.com[^\s>]*/gi, "$1");
    out = out.replace(/url\(\s*["']?\s*https?:\/\/example\.com\/[^)"']+\s*["']?\s*\)/gi, "none");
    out = out.replace(/https?:\/\/example\.com\/[^\s"')>]+/gi, "");

    return out;
}

/* =========================
   Gemini prompt + model run
   ========================= */

const AI_EDIT_SYSTEM_PROMPT = `
You are an HTML refactoring assistant for the Kloner website editor.

SAFETY AND POLICY:
- Follow Gemini safety rules. If the user asks for disallowed content, refuse.
- When refusing:
  - Do NOT change the HTML.
  - Set SUMMARY to: "Request refused for safety reasons. No changes applied."
  - Under HTML: return the original HTML block unchanged.

- NEVER use example.com or placeholder absolute URLs for images, icons, or backgrounds.
- Do not output new external image URLs unless they already exist in the provided HTML.
- Apply minimal, targeted changes; preserve existing content and structure.

RESPONSIVE DESIGN RULES (CRITICAL - SEVERITY 1):
- NEVER remove or modify hamburger menus, mobile navigation toggles, or any mobile-specific UI elements
- PRESERVE all media queries (@media) exactly as they appear in the original HTML
- PRESERVE all responsive utility classes (hidden-mobile, show-desktop, md:, lg:, etc.)
- PRESERVE all JavaScript event handlers and data attributes that control responsive behavior
- PRESERVE viewport meta tags and any responsive configuration
- If editing navigation: keep BOTH desktop AND mobile versions intact
- If unsure whether an element is responsive-critical, DO NOT modify or remove it
- When in doubt, preserve the element and its classes/attributes unchanged

INTERACTIVE FUNCTIONALITY (CRITICAL):
- NEVER remove click handlers, data-toggle, data-target, or similar interactive attributes
- PRESERVE all <script> tags and JavaScript functionality
- PRESERVE event listeners and dynamic behavior
- If an element has JavaScript interactions, keep ALL its attributes

OUTPUT FORMAT (STRICT):
SUMMARY: <one short sentence>
HTML:
<edited HTML>
`.trim();

function parseModelOutput(raw: string, fallbackHtml: string): AiEditModelResult {
    const txt = String(raw || "").trim();
    if (!txt) {
        return {
            ok: false,
            afterHtml: fallbackHtml,
            summary: "AI edit failed; left the block unchanged.",
            errorCode: "MODEL_EMPTY",
            errorStatus: 506,
            userError: "AI edit failed. No changes were applied.",
        };
    }

    const summaryMatch = txt.match(/^SUMMARY:\s*(.+)$/m);
    const summary = summaryMatch && summaryMatch[1].trim() ? summaryMatch[1].trim() : "Minimal changes applied.";

    let htmlSection = txt;
    const htmlMarkerIdx = txt.toLowerCase().indexOf("html:");
    if (htmlMarkerIdx !== -1) htmlSection = txt.slice(htmlMarkerIdx + "html:".length).trim();

    const afterHtml = htmlSection.trim();
    if (!afterHtml) {
        return {
            ok: false,
            afterHtml: fallbackHtml,
            summary: "AI edit failed; left the block unchanged.",
            errorCode: "MODEL_HTML_EMPTY",
            errorStatus: 502,
            userError: "AI edit failed. No changes were applied.",
        };
    }

    return { ok: true, afterHtml, summary };
}

function classifyGeminiError(err: any, requestId: string): { status: number; code: string; userMessage: string; isSafety: boolean } {
    const message = String(err?.message || err?.toString?.() || "unknown_error");
    const lower = message.toLowerCase();

    // google generative ai errors vary; check common signals
    const httpStatus =
        err?.status ||
        err?.response?.status ||
        err?.cause?.status ||
        (lower.includes("429") ? 429 : undefined) ||
        (lower.includes("rate") && lower.includes("limit") ? 429 : undefined);

    const status = typeof httpStatus === "number" ? httpStatus : 503;

    const isSafety =
        lower.includes("safety") ||
        lower.includes("blocked") ||
        lower.includes("harm") ||
        lower.includes("policy") ||
        lower.includes("recitation");

    if (status === 429) {
        return {
            status: 429,
            code: "RATE_LIMITED",
            userMessage: `AI editing is temporarily overloaded. Try again shortly. (Request ID: ${requestId})`,
            isSafety: false,
        };
    }

    if (isSafety) {
        return {
            status: 400,
            code: "SAFETY_REJECTED",
            userMessage: `That request can’t be processed because it was flagged by our safety filters. Try rephrasing with less explicit detail. (Request ID: ${requestId})`,
            isSafety: true,
        };
    }

    return {
        status: status >= 500 ? 503 : 502,
        code: "GEMINI_ERROR",
        userMessage: `AI editing is temporarily unavailable. Try again shortly. (Request ID: ${requestId})`,
        isSafety: false,
    };
}

async function runAiEditModelGemini(input: {
    html: string;
    prompt: string;
    uid: string;
    mode?: "code" | "imagery";
    requestId: string;
}): Promise<AiEditModelResult & { debug?: any }> {
    if (!geminiClient) {
        return {
            ok: false,
            afterHtml: input.html,
            summary: "AI edit failed; left the block unchanged.",
            errorCode: "GEMINI_NOT_CONFIGURED",
            errorStatus: 503,
            userError: "AI editing is not configured on this server.",
            debug: { configured: false },
        };
    }

    const trimmedHtml = trimHtmlForModel(input.html);
    const mode = input.mode ?? "code";

    const user = `
USER INSTRUCTION:
${input.prompt}

CURRENT HTML BLOCK (may be truncated for performance):
${trimmedHtml}
`.trim();

    try {
        const model = geminiClient.getGenerativeModel({
            model: GEMINI_MODEL,
            systemInstruction: AI_EDIT_SYSTEM_PROMPT,
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ],
            generationConfig: {
                maxOutputTokens: 4096,
                temperature: mode === "imagery" ? 0.6 : 0.3,
            },
        });

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: user }] }],
        });

        const response = result?.response as any;

        const raw = (response?.text?.()?.trim?.() ?? "") as string;

        const debug = {
            requestId: input.requestId,
            model: GEMINI_MODEL,
            hasResponse: Boolean(response),
            hasText: Boolean(raw),
            rawSnippet: safeSnippet(raw, 600),
            // best-effort metadata (varies by SDK/version)
            candidates: Array.isArray(response?.candidates)
                ? response.candidates.map((c: any) => ({
                    finishReason: c?.finishReason || null,
                    safetyRatings: c?.safetyRatings || null,
                    tokenCount: c?.tokenCount || null,
                }))
                : null,
            promptFeedback: response?.promptFeedback || null,
            usageMetadata: response?.usageMetadata || null,
        };

        const parsed = parseModelOutput(raw, input.html);

        if (!parsed.ok) {
            return {
                ...parsed,
                debug,
            };
        }

        parsed.afterHtml = stripExampleDotComAssets(parsed.afterHtml);

        return {
            ...parsed,
            debug,
        };
    } catch (err: any) {
        const classified = classifyGeminiError(err, input.requestId);

        console.error("[ai-edit][gemini] call failed", {
            requestId: input.requestId,
            uid: input.uid,
            model: GEMINI_MODEL,
            status: classified.status,
            code: classified.code,
            message: String(err?.message || err),
            stack: err?.stack || null,
        });

        return {
            ok: false,
            afterHtml: input.html,
            summary: "AI edit failed; left the block unchanged.",
            errorCode: classified.code,
            errorStatus: classified.status,
            userError: classified.userMessage,
            debug: {
                requestId: input.requestId,
                model: GEMINI_MODEL,
                status: classified.status,
                code: classified.code,
                message: String(err?.message || err),
            },
        };
    }
}


/* =========================
   Misc helpers
   ========================= */

function normalizeCreatedAtToIso(raw: any): string | null {
    try {
        if (!raw) return null;
        if (typeof raw.toDate === "function") return raw.toDate().toISOString();
        if (raw instanceof Date) return raw.toISOString();
        if (typeof raw === "string") return raw;
        return null;
    } catch {
        return null;
    }
}

/* =========================
   POST handler
   ========================= */

async function handlePost(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req }) => {
        let db: any = null;

        try {
            db = await getAdminDb();
        } catch (err) {
            console.error("[ai-edit] failed to init Firestore", err);
        }

        if (!db) {
            return NextResponse.json({ error: "Service temporarily unavailable. Try again shortly." }, { status: 503 });
        }

        const body = (await req.json()) as Partial<AiEditRequestBody>;
        const requestId = String(body.requestId || "").trim() || randomUUID();

        // PATCH: normalize renderId from alternate keys
        const renderId = normalizeRenderIdFromBody(body);

        const html = body.html ?? "";
        const mode: "code" | "imagery" = body.mode === "imagery" ? "imagery" : "code";

        const action: "edit_block" | "create_page" = body.action === "create_page" ? "create_page" : "edit_block";

        const rawUserPrompt = (body.userPrompt ?? body.prompt ?? "").trim().slice(0, MAX_USER_PROMPT_CHARS);
        const rawDisplayPrompt = (body.originalPrompt ?? "").trim().slice(0, MAX_MODEL_PROMPT_CHARS);

        const ip =
            req.headers.get("x-forwarded-for")?.split(",")?.[0]?.trim() ||
            req.headers.get("x-real-ip")?.trim() ||
            null;

        const ua = req.headers.get("user-agent") || null;

        let modelPrompt = "";

        if (!renderId || !html) {
            return NextResponse.json(
                {
                    error: "renderId and html are required",
                    requestId,
                    debug: {
                        renderIdKeysSeen: renderIdDebugKeys(body),
                        hasHtml: Boolean(String(html || "").trim()),
                    },
                },
                { status: 400 }
            );
        }

        if (action === "create_page") {
            const pageId = String(body.pageId || "").trim();
            const slug = String(body.slug || "").trim();

            if (!pageId || !slug) {
                return NextResponse.json({ error: "pageId and slug are required" }, { status: 400 });
            }

            const built = buildCreatePagePrompt({ pageId, slug, userPrompt: rawUserPrompt });
            modelPrompt = built.modelPrompt.slice(0, MAX_MODEL_PROMPT_CHARS);
        } else {
            if (!rawUserPrompt) {
                return NextResponse.json({ error: "prompt is required" }, { status: 400 });
            }
            modelPrompt = rawUserPrompt.slice(0, MAX_MODEL_PROMPT_CHARS);
        }

        // Load user tier + email
        let userRef: any = null;
        let tier: UserTier = "free";
        let userEmail: string | null = null;

        try {
            userRef = db.collection("kloner_users").doc(uid);
            const userSnap = await userRef.get();
            if (userSnap.exists) {
                const data = userSnap.data() as any;
                const rawTierValue = (data.userTier ?? data.tier) as string | undefined;
                const rawTier = rawTierValue?.toLowerCase();
                if (rawTier === "pro" || rawTier === "agency" || rawTier === "enterprise" || rawTier === "free") {
                    tier = rawTier as UserTier;
                }
                userEmail = (data.email || data.userEmail || null) as any;
            }
        } catch (e) {
            console.error("[ai-edit] failed to read userTier/email; defaulting to free", e);
            tier = "free";
        }

        const now = new Date();

        // Reserve credits (Gemini safety may block; we refund on block)
        let creditsRemaining: number | null = null;
        let creditsLimit: number | null = null;

        const ipHash = ip ? hashIp(ip) : null;
        const debugForCreditEvent = {
            renderId,
            action,
            mode,
            pageId: action === "create_page" ? String(body.pageId || "").trim() || undefined : undefined,
            slug: action === "create_page" ? String(body.slug || "").trim() || undefined : undefined,
            userPrompt: rawUserPrompt,
            ipHash,
            ua,
        };

        try {
            const r = await reserveAiEditCreditsInline({
                db,
                uid,
                tier,
                cost: 5,
                now,
                requestId,
                debug: debugForCreditEvent,
            });

            if (!r.ok) {
                return NextResponse.json(
                    {
                        error: r.message,
                        meta: { tier, creditsRemaining: r.remaining, creditsLimit: r.limit },
                        requestId,
                    },
                    { status: r.status }
                );
            }

            creditsRemaining = r.remaining;
            creditsLimit = r.limit;
        } catch (err) {
            console.error("[ai-edit] credit reserve transaction failed; failing closed", err);
            return NextResponse.json({ error: "Service temporarily unavailable. Try again shortly.", requestId }, { status: 503 });
        }

        // Run Gemini model
        const modelResult = await runAiEditModelGemini({
            html,
            prompt: modelPrompt,
            uid,
            mode,
            requestId,
        });

        if (!modelResult.ok) {
            // Safety rejection: record abuse
            if (modelResult.errorCode === "SAFETY_REJECTED") {
                await recordAbuseAndMaybeAlert({
                    db,
                    uid,
                    userEmail,
                    reason: "SAFETY_REJECTED (gemini blocked)",
                    requestId,
                    promptSnippet: rawUserPrompt,
                    ip,
                    ua,
                });
            }

            // Always refund on model failure
            await refundAiEditCreditsInline({
                db,
                uid,
                tier,
                cost: 5,
                now: new Date(),
                requestId,
                reason: modelResult.errorCode || "model_failed",
                errorCode: modelResult.errorCode,
                errorStatus: modelResult.errorStatus,
            });

            try {
                const b = await ensureAiEditBucketInline({ db, uid, tier, now: new Date() });
                creditsRemaining = b.remaining;
                creditsLimit = b.limit;
            } catch { }

            return NextResponse.json(
                {
                    error: modelResult.userError || "AI edit failed. No changes were applied.",
                    meta: { tier, creditsRemaining, creditsLimit },
                    requestId,
                },
                { status: modelResult.errorStatus || 502 }
            );
        }

        // Strip placeholder assets (critical)
        let afterHtml = stripExampleDotComAssets(modelResult.afterHtml);

        // Cleanup any remaining slot placeholders/comments from legacy pipelines (no image generation here)
        afterHtml = afterHtml
            .replace(/__KLONER_IMAGE_SLOT_\d+__/g, "")
            .replace(/<!--\s*KLONER_IMAGE_SLOT_\d+\s*:[\s\S]*?-->/g, "");

        afterHtml = stripExampleDotComAssets(afterHtml);

        if (String(afterHtml || "").trim() === String(html || "").trim()) {
            await refundAiEditCreditsInline({
                db,
                uid,
                tier,
                cost: 5,
                now: new Date(),
                requestId,
                reason: "no_change_applied",
            });

            try {
                const b = await ensureAiEditBucketInline({ db, uid, tier, now: new Date() });
                creditsRemaining = b.remaining;
                creditsLimit = b.limit;
            } catch { }

            return NextResponse.json(
                {
                    error: "No changes were applied for this request.",
                    meta: { tier, creditsRemaining, creditsLimit },
                    requestId,
                },
                { status: 422 }
            );
        }

        const summary = modelResult.summary;

        // Persist history; if fails, refund
        let aiEditsRef: any = null;

        try {
            const renderRef = userRef.collection("kloner_renders").doc(renderId);

            const renderSnap = await renderRef.get();
            if (!renderSnap.exists) {
                await renderRef.set({ uid, renderId, createdAt: now, source: "ai-edit-shell" }, { merge: true });
            }

            aiEditsRef = renderRef.collection("ai_edits");

            const historyDoc = {
                renderId,
                action,
                prompt: rawUserPrompt,
                displayPrompt: rawDisplayPrompt || modelPrompt,
                modelPrompt,
                userQuestion: rawUserPrompt, // Explicit field for debugging
                summary,
                beforeHtml: html,
                afterHtml,
                createdAt: now,
                uid,
                requestId,
                provider: "gemini",
                model: GEMINI_MODEL,
                mode,
            };

            console.log("[ai-edit] Storing history doc:", {
                renderId,
                requestId,
                action,
                hasPrompt: Boolean(rawUserPrompt),
                promptLength: rawUserPrompt.length,
                promptSnippet: safeSnippet(rawUserPrompt, 100),
                hasDisplayPrompt: Boolean(rawDisplayPrompt),
                hasModelPrompt: Boolean(modelPrompt),
            });

            const docRef = aiEditsRef.doc();
            await docRef.set(historyDoc);

            try {
                const extraSnap = await aiEditsRef.orderBy("createdAt", "desc").offset(5).get();
                if (!extraSnap.empty) {
                    const batch = db.batch();
                    extraSnap.docs.forEach((d: any) => batch.delete(d.ref));
                    await batch.commit();
                }
            } catch (err) {
                console.error("[ai-edit] failed trimming history", err);
            }
        } catch (err) {
            console.error("[ai-edit] Firestore history write failed; refunding", err);

            await refundAiEditCreditsInline({
                db,
                uid,
                tier,
                cost: 5,
                now: new Date(),
                requestId,
                reason: "history_write_failed",
            });

            try {
                const b = await ensureAiEditBucketInline({ db, uid, tier, now: new Date() });
                creditsRemaining = b.remaining;
                creditsLimit = b.limit;
            } catch { }

            return NextResponse.json(
                {
                    error: "Failed to save this AI edit. No credits were consumed.",
                    meta: { tier, creditsRemaining, creditsLimit },
                    requestId,
                },
                { status: 503 }
            );
        }

        await commitAiEditCreditsInline({ db, uid, requestId, now: new Date(), summary });

        const latestSnap = await aiEditsRef.orderBy("createdAt", "desc").limit(5).get();

        const suggestions = latestSnap.docs.map((d: any) => {
            const data = d.data() as any;
            return { id: d.id, ...data, createdAt: normalizeCreatedAtToIso(data.createdAt) };
        });

        return NextResponse.json(
            {
                suggestions,
                meta: { tier, creditsRemaining, creditsLimit },
                requestId,
            },
            { status: 200 }
        );
    });
}

/* =========================
   GET handler
   ========================= */

async function handleGet(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req }) => {
        let db: any = null;

        try {
            db = await getAdminDb();
        } catch (err) {
            console.error("[ai-edit] failed to init Firestore on GET", err);
        }

        const { searchParams } = new URL(req.url);

        // PATCH: accept renderId from multiple query params
        const renderId =
            searchParams.get("renderId")?.trim() ||
            searchParams.get("renderDocId")?.trim() ||
            searchParams.get("id")?.trim() ||
            searchParams.get("docId")?.trim() ||
            "";

        if (!renderId) {
            return NextResponse.json(
                {
                    error: "renderId is required",
                    debug: {
                        query: {
                            renderId: searchParams.get("renderId"),
                            renderDocId: searchParams.get("renderDocId"),
                            id: searchParams.get("id"),
                            docId: searchParams.get("docId"),
                        },
                    },
                },
                { status: 400 }
            );
        }

        if (!db) {
            return NextResponse.json(
                { suggestions: [], meta: { tier: "free", creditsRemaining: null, creditsLimit: null } },
                { status: 200 }
            );
        }

        try {
            const userRef = db.collection("kloner_users").doc(uid);

            let tier: UserTier = "free";
            try {
                const userSnap = await userRef.get();
                if (userSnap.exists) {
                    const data = userSnap.data() as any;
                    const rawTierValue = (data.userTier ?? data.tier) as string | undefined;
                    const rawTier = rawTierValue?.toLowerCase();
                    if (rawTier === "pro" || rawTier === "agency" || rawTier === "enterprise" || rawTier === "free") {
                        tier = rawTier as UserTier;
                    }
                }
            } catch (e) {
                console.error("[ai-edit][GET] failed to read userTier/tier; defaulting to free", e);
                tier = "free";
            }

            let creditsRemaining: number | null = null;
            let creditsLimit: number | null = null;

            try {
                const now = new Date();
                const b = await ensureAiEditBucketInline({ db, uid, tier, now });
                creditsRemaining = b.remaining;
                creditsLimit = b.limit;
            } catch (e) {
                console.error("[ai-edit][GET] failed ensuring credits bucket", e);
            }

            const renderRef = userRef.collection("kloner_renders").doc(renderId);
            const renderSnap = await renderRef.get();

            if (!renderSnap.exists) {
                return NextResponse.json({ suggestions: [], meta: { tier, creditsRemaining, creditsLimit } }, { status: 200 });
            }

            const aiEditsRef = renderRef.collection("ai_edits");
            const snap = await aiEditsRef.orderBy("createdAt", "desc").limit(5).get();

            const suggestions = snap.docs.map((d: any) => {
                const data = d.data() as any;
                return { id: d.id, ...data, createdAt: normalizeCreatedAtToIso(data.createdAt) };
            });

            console.log("[ai-edit][GET] Retrieved suggestions:", {
                renderId,
                count: suggestions.length,
                samples: suggestions.slice(0, 2).map((s: { id: any; prompt: any; userQuestion: any; action: any; }) => ({
                    id: s.id,
                    hasPrompt: Boolean(s.prompt),
                    hasUserQuestion: Boolean(s.userQuestion),
                    promptSnippet: safeSnippet(s.prompt || s.userQuestion || "", 60),
                    action: s.action,
                })),
            });

            return NextResponse.json({ suggestions, meta: { tier, creditsRemaining, creditsLimit } }, { status: 200 });
        } catch (err) {
            console.error("[ai-edit] Firestore GET failed", err);
            return NextResponse.json(
                { suggestions: [], meta: { tier: "free", creditsRemaining: null, creditsLimit: null } },
                { status: 200 }
            );
        }
    });
}

export async function POST(req: NextRequest) {
    return handlePost(req);
}

export async function GET(req: NextRequest) {
    return handleGet(req);
}
