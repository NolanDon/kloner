// app/api/ai-edit/route.ts
//
// PATCH: abuse alerting + placeholder asset stripping
// - If a user repeatedly triggers safety systems (moderation flag / safety reject / image-block),
//   email support@kloner.com with details.
// - Hard-strip any example.com asset URLs so they can never leak into saved HTML (prevents 404s like example.com/homer-donut.jpg).
//
// Env required:
// - RESEND_API_KEY
// - ABUSE_ALERT_FROM (fallback: hello@kloner.app)

import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import OpenAI from "openai";
import { monthlyLimitFor, type UserTier } from "@/src/lib/credits";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { randomUUID, createHash } from "crypto";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

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
}

interface AiEditModelResult {
    ok: boolean;
    afterHtml: string;
    summary: string;
    errorCode?: string;
    errorStatus?: number;
    userError?: string;
}

const MAX_HTML_CHARS = 8_000;
const MAX_USER_PROMPT_CHARS = 1_000;
const MAX_MODEL_PROMPT_CHARS = 2_200;

const STORAGE_BUCKET =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    undefined;

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

        if ("error" in result && result.error) {
            console.error("[ai-edit][abuse] Resend error:", result.error);
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

function friendlySafetyMessage(requestId?: string) {
    const rid = requestId ? ` (Request ID: ${requestId})` : "";
    return {
        user:
            `That request can’t be processed because it was flagged by our safety filters. ` +
            `Try rephrasing with less explicit detail, or remove anything that could be interpreted as harmful or disallowed.` +
            `${rid}`,
        dev: `Rejected by safety system${requestId ? `; requestId=${requestId}` : ""}`,
    };
}

function creditEventRef(db: any, uid: string, requestId: string) {
    return db.collection("kloner_users").doc(uid).collection("credit_events").doc(requestId);
}

async function reserveAiEditCreditsInline(opts: {
    db: any;
    uid: string;
    tier: UserTier;
    cost: number;
    now: Date;
    requestId: string;
}): Promise<
    | {
        ok: true;
        remaining: number | null;
        limit: number | null;
        periodEnd: Date | null;
        alreadyReservedOrCommitted?: boolean;
    }
    | {
        ok: false;
        status: number;
        message: string;
        remaining: number;
        limit: number;
        periodEnd: Date | null;
    }
> {
    const { db, uid, tier, cost, now, requestId } = opts;

    const limit = monthlyLimitFor(tier, "edit");
    if (!limit) {
        return { ok: true, remaining: null, limit: 0, periodEnd: null };
    }

    const userRef = db.collection("kloner_users").doc(uid);
    const evtRef = creditEventRef(db, uid, requestId);

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
                const existingRemaining =
                    typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

                const endDate = active ? (periodEndDate as Date) : nextPeriodEndUtc(now);
                const startRemaining = active && existingRemaining !== null ? existingRemaining : limit;

                return {
                    ok: true,
                    remaining: startRemaining,
                    limit,
                    periodEnd: endDate,
                    alreadyReservedOrCommitted: true,
                };
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
        const existingRemaining =
            typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

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
}) {
    const { db, uid, tier, cost, now, requestId, reason } = opts;

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

        const existingRemaining =
            typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

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
                refundReason: reason,
            },
            { merge: true }
        );
    });
}

async function commitAiEditCreditsInline(opts: { db: any; uid: string; requestId: string; now: Date }) {
    const { db, uid, requestId, now } = opts;
    const evtRef = creditEventRef(db, uid, requestId);

    try {
        await db.runTransaction(async (tx: any) => {
            const snap = await tx.get(evtRef);
            if (!snap.exists) return;
            const evt = snap.data() as any;
            const status = String(evt?.status || "");
            if (status === "committed") return;
            if (status !== "reserved") return;

            tx.set(evtRef, { status: "committed", committedAt: now }, { merge: true });
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
        const existingRemaining =
            typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

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

function inferPageIntentFromSlug(slug: string): {
    kind:
    | "about"
    | "contact"
    | "pricing"
    | "services"
    | "faq"
    | "blog"
    | "features"
    | "landing"
    | "generic";
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

    const globalLayoutLine =
        `Do NOT add or modify global header or footer elements.`;

    const privacyLine =
        `Do not print the route path anywhere in visible content.`;

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

function extractTextFromResponse(resp: any): string {
    if (!resp || !resp.output) return "";

    const outputs = Array.isArray(resp.output) ? resp.output : [resp.output];
    const chunks: string[] = [];

    for (const out of outputs) {
        const content = Array.isArray(out?.content) ? out.content : [];
        for (const c of content) {
            const txt = (c as any)?.text?.value ?? (c as any)?.text ?? "";
            if (typeof txt === "string" && txt.trim().length > 0) {
                chunks.push(txt);
            }
        }
    }

    return chunks.join("\n").trim();
}

async function assertPromptSafe(prompt: string) {
    const moderation = await client.moderations.create({
        model: "omni-moderation-latest",
        input: prompt,
    });

    const result: any = (moderation as any).results?.[0];
    if (!result) {
        const err = new Error("moderation_failed");
        (err as any).code = "MODERATION_ERROR";
        throw err;
    }

    if (result.flagged) {
        const err = new Error("prompt_unsafe");
        (err as any).code = "PROMPT_UNSAFE";
        throw err;
    }
}

function extractImageSlots(html: string): { index: number; prompt: string }[] {
    const slots: { index: number; prompt: string }[] = [];
    const regex = /<!--\s*KLONER_IMAGE_SLOT_(\d+)\s*:(.*?)-->/gis;

    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
        const idx = parseInt(m[1], 10);
        if (Number.isNaN(idx)) continue;
        const prompt = (m[2] || "").trim();
        if (!prompt) continue;
        slots.push({ index: idx, prompt });
    }

    return slots;
}

async function compressImageBuffer(buf: Buffer): Promise<Buffer> {
    try {
        return await sharp(buf).jpeg({ quality: 78, chromaSubsampling: "4:2:0" }).toBuffer();
    } catch (err) {
        console.error("[ai-edit] compressImageBuffer failed, returning original", err);
        return buf;
    }
}

type ImageDebug = {
    imageSlotsFound: number;
    imageSlotsMaterialized: number;
    imageUrls: { index: number; url: string; prompt: string }[];
    imageErrorStatus?: number;
    imageErrorMessage?: string;
};

async function materializeAiImages(
    html: string,
    opts: { uid: string; renderId: string; originalHtml?: string }
): Promise<{ html: string; debug: ImageDebug }> {
    const originalHtml = opts.originalHtml ?? html;

    const debug: ImageDebug = {
        imageSlotsFound: 0,
        imageSlotsMaterialized: 0,
        imageUrls: [],
    };

    if (!STORAGE_BUCKET) {
        console.warn("[ai-edit] STORAGE_BUCKET not configured; skipping AI image materialization");
        return { html, debug };
    }

    const slots = extractImageSlots(html);
    debug.imageSlotsFound = slots.length;

    if (!slots.length) return { html, debug };

    const bucket = getStorage().bucket(STORAGE_BUCKET);
    const slotUrlMap = new Map<number, string>();

    for (const slot of slots) {
        try {
            await assertPromptSafe(slot.prompt);

            const imgResp = await client.images.generate({
                model: "gpt-image-1",
                prompt: slot.prompt,
                size: "1024x1024",
                n: 1,
            });

            const first = (imgResp as any)?.data?.[0];
            const b64 = first?.b64_json;

            if (!b64 || typeof b64 !== "string") continue;

            let buf = Buffer.from(b64, "base64");
            buf = (await compressImageBuffer(buf)) as any;

            const now = Date.now();
            const filePath = `kloner_ai_images/${opts.renderId}/${now}_slot_${slot.index}.jpg`;
            const file = bucket.file(filePath);

            await file.save(buf, {
                contentType: "image/jpeg",
                resumable: false,
                metadata: { cacheControl: "public,max-age=31536000" },
            });

            const [signedUrl] = await file.getSignedUrl({
                action: "read",
                expires: "2500-01-01",
            });

            slotUrlMap.set(slot.index, signedUrl);
            debug.imageUrls.push({ index: slot.index, url: signedUrl, prompt: slot.prompt });
        } catch (err: any) {
            const status: number | undefined = err?.status ?? err?.response?.status;
            const message: string = err?.error?.message ?? err?.message ?? String(err);

            console.error("[ai-edit] failed generating/uploading AI image for slot", slot, { status, message });

            if (status) {
                debug.imageErrorStatus = status;
                debug.imageErrorMessage = message;
                break;
            }

            if (err?.code === "PROMPT_UNSAFE" || err?.code === "MODERATION_ERROR") {
                debug.imageErrorStatus = 400;
                debug.imageErrorMessage = "Image prompt was blocked or moderation failed; reverting image changes.";
                break;
            }
        }
    }

    debug.imageSlotsMaterialized = slotUrlMap.size;

    let outHtml = html;

    if (slotUrlMap.size === 0) {
        outHtml = outHtml.replace(/<!--\s*KLONER_IMAGE_SLOT_\d+\s*:[\s\S]*?-->/g, "");
        outHtml = outHtml.replace(/__KLONER_IMAGE_SLOT_\d+__/g, "");

        if (debug.imageErrorStatus === 400 || debug.imageErrorStatus === 403 || debug.imageErrorStatus === 401) {
            return { html: originalHtml, debug };
        }

        return { html: outHtml, debug };
    }

    for (const [idx, url] of slotUrlMap.entries()) {
        const placeholder = new RegExp(`__KLONER_IMAGE_SLOT_${idx}__`, "g");
        outHtml = outHtml.replace(placeholder, url);
    }

    outHtml = outHtml.replace(/__KLONER_IMAGE_SLOT_\d+__/g, "");
    outHtml = outHtml.replace(/<!--\s*KLONER_IMAGE_SLOT_\d+\s*:[\s\S]*?-->/g, "");

    return { html: outHtml, debug };
}

const AI_EDIT_SYSTEM_PROMPT = `
You are an HTML refactoring assistant for the Kloner website editor.

SAFETY AND POLICY (MUST FOLLOW):
- You must comply with OpenAI safety policies at all times.
- If the user asks for anything involving:
  - illegal content,
  - child sexual content,
  - explicit sexual content,
  - graphic violence,
  - self-harm,
  - hate or harassment,
  - or instructions that meaningfully facilitate wrongdoing
    (for example: hacking, explosives, serious harm),
  you MUST REFUSE.
- When refusing:
  - Do NOT change the HTML.
  - Set SUMMARY to a short refusal message like:
    "Request refused for safety reasons. No changes applied."
  - Under HTML: return the original HTML block unchanged.

- NEVER use example.com or placeholder absolute URLs for images, icons, or backgrounds.
- If you need a new image, you MUST use the Kloner slot format:
  - Place __KLONER_IMAGE_SLOT_N__ where the URL goes
  - Include: <!-- KLONER_IMAGE_SLOT_N: <short safe image description> -->
- Do not output any external image URLs unless they already exist in the provided HTML.

ROLE:
- You receive the HTML for a single selected block plus a short user instruction.
- Apply minimal, targeted changes; preserve existing content and structure.

OUTPUT FORMAT (STRICT):
SUMMARY: <one short sentence>
HTML:
<edited HTML>
`.trim();

/**
 * Hard kill-switch for placeholder assets.
 * Fixes your exact symptom: model injects https://example.com/homer-donut.jpg which then 404s in the iframe.
 *
 * Strategy:
 * - Replace any example.com src/href with an inert data URL (NOT empty string, to avoid weird fetch behavior).
 * - Wipe srcset containing example.com.
 * - Remove any <link ... href="https://example.com/..."> entirely (icons are common offenders).
 * - Kill CSS url(https://example.com/...) to "none".
 * - Catch both quoted and unquoted attribute forms.
 */
function stripExampleDotComAssets(html: string) {
    if (!html) return html;

    let out = String(html);

    // Remove <link ... href="https://example.com/..."> tags entirely
    out = out.replace(/<link\b[^>]*\bhref\s*=\s*(?:"|')https?:\/\/example\.com\/[^"']+(?:"|')[^>]*>/gi, "");

    // src="https://example.com/..." or src='...'
    out = out.replace(/(\ssrc\s*=\s*["'])https?:\/\/example\.com\/[^"']+(["'])/gi, '$1data:,$2');

    // src=https://example.com/... (unquoted)
    out = out.replace(/(\ssrc\s*=\s*)https?:\/\/example\.com\/[^\s>]+/gi, "$1data:,");

    // href="https://example.com/..."
    out = out.replace(/(\shref\s*=\s*["'])https?:\/\/example\.com\/[^"']+(["'])/gi, '$1#$2');

    // href=https://example.com/... (unquoted)
    out = out.replace(/(\shref\s*=\s*)https?:\/\/example\.com\/[^\s>]+/gi, "$1#");

    // srcset containing example.com -> blank it
    out = out.replace(/(\ssrcset\s*=\s*["'])[^"']*example\.com[^"']*(["'])/gi, "$1$2");
    out = out.replace(/(\ssrcset\s*=\s*)[^\s>]*example\.com[^\s>]*/gi, "$1");

    // CSS url(...) pointing to example.com
    out = out.replace(/url\(\s*["']?\s*https?:\/\/example\.com\/[^)"']+\s*["']?\s*\)/gi, "none");

    // Final sweep: any remaining raw example.com urls
    out = out.replace(/https?:\/\/example\.com\/[^\s"')>]+/gi, "");

    return out;
}

async function runAiEditModel(input: {
    html: string;
    prompt: string;
    uid: string;
    mode?: "code" | "imagery";
    requestId: string;
}): Promise<AiEditModelResult> {
    const trimmedHtml = trimHtmlForModel(input.html);
    const { prompt, uid } = input;
    const mode = input.mode ?? "code";

    const user = `
USER INSTRUCTION:
${prompt}

CURRENT HTML BLOCK (may be truncated for performance):
${trimmedHtml}
`.trim();

    if (mode === "code" && geminiClient) {
        try {
            const model = geminiClient.getGenerativeModel({ model: "gemini-3-pro-preview" });
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: `${AI_EDIT_SYSTEM_PROMPT}\n\n${user}` }] }],
            });

            const raw = result.response?.text()?.trim() ?? "";
            if (!raw) {
                return {
                    ok: false,
                    afterHtml: input.html,
                    summary: "AI edit failed; left the block unchanged.",
                    errorCode: "MODEL_EMPTY",
                    errorStatus: 502,
                    userError: "AI edit failed. No changes were applied.",
                };
            }

            const summaryMatch = raw.match(/^SUMMARY:\s*(.+)$/m);
            const summary = summaryMatch && summaryMatch[1].trim() ? summaryMatch[1].trim() : "Minimal changes applied.";

            let htmlSection = raw;
            const htmlMarkerIdx = raw.toLowerCase().indexOf("html:");
            if (htmlMarkerIdx !== -1) htmlSection = raw.slice(htmlMarkerIdx + "html:".length).trim();

            const afterHtml = htmlSection.trim();
            if (!afterHtml) {
                return {
                    ok: false,
                    afterHtml: input.html,
                    summary: "AI edit failed; left the block unchanged.",
                    errorCode: "MODEL_HTML_EMPTY",
                    errorStatus: 502,
                    userError: "AI edit failed. No changes were applied.",
                };
            }

            return { ok: true, afterHtml, summary };
        } catch (err: any) {
            console.error("[ai-edit] Gemini call failed", { name: err?.name, message: err?.message });
        }
    }

    try {
        const resp = await client.responses.create({
            model: "gpt-5-mini",
            input: [
                { role: "system", content: [{ type: "input_text", text: AI_EDIT_SYSTEM_PROMPT }] },
                { role: "user", content: [{ type: "input_text", text: user }] },
            ],
            max_output_tokens: 12_000,
            metadata: { feature: "kloner_ai_edit", uid, requestId: input.requestId },
        });

        const raw = extractTextFromResponse(resp);
        if (!raw) {
            return {
                ok: false,
                afterHtml: input.html,
                summary: "AI edit failed; left the block unchanged.",
                errorCode: "MODEL_EMPTY",
                errorStatus: 502,
                userError: "AI edit failed. No changes were applied.",
            };
        }

        const summaryMatch = raw.match(/^SUMMARY:\s*(.+)$/m);
        const summary = summaryMatch && summaryMatch[1].trim() ? summaryMatch[1].trim() : "Minimal changes applied.";

        let htmlSection = raw;
        const htmlMarkerIdx = raw.toLowerCase().indexOf("html:");
        if (htmlMarkerIdx !== -1) htmlSection = raw.slice(htmlMarkerIdx + "html:".length).trim();

        const afterHtml = htmlSection.trim();
        if (!afterHtml) {
            return {
                ok: false,
                afterHtml: input.html,
                summary: "AI edit failed; left the block unchanged.",
                errorCode: "MODEL_HTML_EMPTY",
                errorStatus: 502,
                userError: "AI edit failed. No changes were applied.",
            };
        }

        return { ok: true, afterHtml, summary };
    } catch (err: any) {
        const status: number | undefined = err?.status ?? err?.response?.status;
        const message: string = err?.error?.message ?? err?.message ?? String(err);

        const lower = String(message || "").toLowerCase();
        const looksLikeSafetyReject =
            lower.includes("rejected by the safety system") ||
            lower.includes("safety system") ||
            lower.includes("policy") ||
            status === 403;

        return {
            ok: false,
            afterHtml: input.html,
            summary: "AI edit failed; left the block unchanged.",
            errorCode: looksLikeSafetyReject ? "SAFETY_REJECTED" : "OPENAI_ERROR",
            errorStatus: status || 502,
            userError: looksLikeSafetyReject ? friendlySafetyMessage(input.requestId).user : "AI edit failed. No changes were applied.",
        };
    }
}

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

        const renderId = body.renderId?.trim();
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
            return NextResponse.json({ error: "renderId and html are required" }, { status: 400 });
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

        // Safety gate BEFORE credits
        try {
            await assertPromptSafe(rawUserPrompt || "create_page");
        } catch (err: any) {
            const code = err?.code || "MODERATION_ERROR";

            if (code === "PROMPT_UNSAFE") {
                await recordAbuseAndMaybeAlert({
                    db,
                    uid,
                    userEmail,
                    reason: "PROMPT_UNSAFE (moderation flagged)",
                    requestId,
                    promptSnippet: rawUserPrompt,
                    ip,
                    ua,
                });

                const friendly = friendlySafetyMessage(requestId);
                return NextResponse.json({ error: friendly.user, requestId }, { status: 400 });
            }

            return NextResponse.json(
                { error: "AI editing is temporarily unavailable due to a safety system error. Try again later." },
                { status: 503 }
            );
        }

        const now = new Date();

        // Reserve credits
        let creditsRemaining: number | null = null;
        let creditsLimit: number | null = null;

        try {
            const r = await reserveAiEditCreditsInline({
                db,
                uid,
                tier,
                cost: 5,
                now,
                requestId,
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

        // Run model
        const modelResult = await runAiEditModel({
            html,
            prompt: modelPrompt,
            uid,
            mode,
            requestId,
        });

        if (!modelResult.ok) {
            if (modelResult.errorCode === "SAFETY_REJECTED") {
                await recordAbuseAndMaybeAlert({
                    db,
                    uid,
                    userEmail,
                    reason: "SAFETY_REJECTED (model response blocked)",
                    requestId,
                    promptSnippet: rawUserPrompt,
                    ip,
                    ua,
                });
            }

            await refundAiEditCreditsInline({
                db,
                uid,
                tier,
                cost: 5,
                now: new Date(),
                requestId,
                reason: modelResult.errorCode || "model_failed",
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

        // Materialize images + strip placeholder assets (critical)
        let afterHtml = modelResult.afterHtml;
        let imageDebug: ImageDebug = {
            imageSlotsFound: 0,
            imageSlotsMaterialized: 0,
            imageUrls: [],
        };

        // Strip immediately, even before image pipeline, because model can inject example.com directly
        afterHtml = stripExampleDotComAssets(afterHtml);

        try {
            const result = await materializeAiImages(afterHtml, {
                uid,
                renderId: renderId!,
                originalHtml: html,
            });

            afterHtml = result.html;
            imageDebug = result.debug;

            // Strip again after image pipeline (belt + suspenders)
            afterHtml = stripExampleDotComAssets(afterHtml);

            if (
                imageDebug.imageSlotsFound > 0 &&
                imageDebug.imageSlotsMaterialized === 0 &&
                (imageDebug.imageErrorStatus === 400 ||
                    imageDebug.imageErrorStatus === 401 ||
                    imageDebug.imageErrorStatus === 403)
            ) {
                await recordAbuseAndMaybeAlert({
                    db,
                    uid,
                    userEmail,
                    reason: `IMAGE_BLOCKED (${imageDebug.imageErrorStatus})`,
                    requestId,
                    promptSnippet: safeSnippet(imageDebug.imageErrorMessage || rawUserPrompt, 220),
                    ip,
                    ua,
                });

                await refundAiEditCreditsInline({
                    db,
                    uid,
                    tier,
                    cost: 5,
                    now: new Date(),
                    requestId,
                    reason: `image_blocked_${imageDebug.imageErrorStatus || "unknown"}`,
                });

                try {
                    const b = await ensureAiEditBucketInline({ db, uid, tier, now: new Date() });
                    creditsRemaining = b.remaining;
                    creditsLimit = b.limit;
                } catch { }

                return NextResponse.json(
                    {
                        error:
                            `We couldn’t generate one of the requested images due to safety filters. ` +
                            `Try a simpler, more general description and run it again. ` +
                            `(Request ID: ${requestId})`,
                        meta: { tier, creditsRemaining, creditsLimit },
                        debug: imageDebug,
                        requestId,
                    },
                    { status: imageDebug.imageErrorStatus || 400 }
                );
            }
        } catch (err) {
            console.error("[ai-edit] materializeAiImages failed", err);
        }

        // Cleanup any remaining slots/comments, then strip placeholder assets one last time
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
                    debug: imageDebug,
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

            const docRef = aiEditsRef.doc();
            await docRef.set({
                renderId,
                action,
                prompt: rawUserPrompt,
                displayPrompt: rawDisplayPrompt || modelPrompt,
                modelPrompt,
                summary,
                beforeHtml: html,
                afterHtml,
                createdAt: now,
                uid,
                requestId,
            });

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

        await commitAiEditCreditsInline({ db, uid, requestId, now: new Date() });

        const latestSnap = await aiEditsRef.orderBy("createdAt", "desc").limit(5).get();

        const suggestions = latestSnap.docs.map((d: any) => {
            const data = d.data() as any;
            return { id: d.id, ...data, createdAt: normalizeCreatedAtToIso(data.createdAt) };
        });

        return NextResponse.json(
            {
                suggestions,
                meta: { tier, creditsRemaining, creditsLimit },
                debug: imageDebug,
                requestId,
            },
            { status: 200 }
        );
    });
}

async function handleGet(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req }) => {
        let db: any = null;

        try {
            db = await getAdminDb();
        } catch (err) {
            console.error("[ai-edit] failed to init Firestore on GET", err);
        }

        const { searchParams } = new URL(req.url);
        const renderId = searchParams.get("renderId")?.trim();

        if (!renderId) {
            return NextResponse.json({ error: "renderId is required" }, { status: 400 });
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
