// app/api/private/send-journey-emails/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminAuth, getAdminDb } from "../../_lib/auth";
import crypto from "crypto";
import { captureCriticalEvent, captureException } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const JOURNEY_EMAIL_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours

// Keep well under Resend's 100/day cap.
const RESEND_DAILY_LIMIT = 90;

// Make sure we only ever email a subset per run.
const MAX_JOURNEY_SENDS_PER_RUN = 25;
const MAX_PRODUCT_SENDS_PER_RUN = 90;

// Firestore documents for operational counters.
const EMAIL_LIMITS_COLLECTION = "internal_email_limits";

// Resend limit: 2 req / second
const RESEND_MIN_INTERVAL_MS = 550;

function baseUrl() {
    const v = (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
    if (v) return v.replace(/\/$/, "");
    return "https://kloner.app";
}

function dayKeyUtc(ms = Date.now()): string {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function getEmailLinkSecret(): string {
    const s = (process.env.EMAIL_LINK_SECRET || "").trim();
    if (!s) throw new Error("EMAIL_LINK_SECRET env not set");
    return s;
}

function hmacBase64Url(secret: string, msg: string): string {
    return crypto.createHmac("sha256", secret).update(msg).digest("base64url");
}

function makeSignedToken(payload: Record<string, any>): string {
    const secret = getEmailLinkSecret();
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = hmacBase64Url(secret, body);
    return `${body}.${sig}`;
}

function makeClickUrl(params: { uid: string; campaign: string; destUrl: string; step?: string | null }) {
    const u = new URL(`${baseUrl()}/api/email/click`);
    const token = makeSignedToken({
        uid: params.uid,
        c: params.campaign,
        d: params.destUrl,
        s: params.step || null,
        ts: Date.now(),
    });
    u.searchParams.set("t", token);
    return u.toString();
}

function makeUnsubUrl(params: { uid: string; kind: "journey" | "product" | "all" }) {
    const u = new URL(`${baseUrl()}/api/email/unsubscribe`);
    const token = makeSignedToken({ uid: params.uid, k: params.kind, ts: Date.now() });
    u.searchParams.set("t", token);
    return u.toString();
}

async function consumeDailyQuota(db: FirebaseFirestore.Firestore, howMany = 1): Promise<boolean> {
    const n = Math.max(1, Math.floor(howMany));
    const key = dayKeyUtc();
    const ref = db.collection(EMAIL_LIMITS_COLLECTION).doc(`resend_${key}`);
    try {
        const ok = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const used = snap.exists && typeof snap.data()?.used === "number" ? (snap.data()!.used as number) : 0;
            if (used + n > RESEND_DAILY_LIMIT) return false;
            tx.set(
                ref,
                {
                    used: used + n,
                    limit: RESEND_DAILY_LIMIT,
                    dayKey: key,
                    updatedAtMs: Date.now(),
                },
                { merge: true },
            );
            return true;
        });
        return ok;
    } catch (e) {
        console.error("consumeDailyQuota failed", e);
        // Fail closed: if we can't verify quota, don't send.
        return false;
    }
}

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function requireInternal(req: NextRequest) {
    const key = process.env.INTERNAL_API_KEY || "";
    const got = req.headers.get("x-internal-key") || "";
    if (!key || got !== key) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
}

function buildUtm(url: string, tier: number, step: string) {
    const u = new URL(url);
    u.searchParams.set("utm_source", "journey_email");
    u.searchParams.set("utm_medium", "email");
    u.searchParams.set("utm_campaign", "journey_nudge");
    u.searchParams.set("utm_content", `tier${tier}_${step}`);
    return u.toString();
}

function buildUtmGeneric(url: string, args: { source: string; campaign: string; content?: string }) {
    const u = new URL(url);
    u.searchParams.set("utm_source", args.source);
    u.searchParams.set("utm_medium", "email");
    u.searchParams.set("utm_campaign", args.campaign);
    if (args.content) u.searchParams.set("utm_content", args.content);
    return u.toString();
}

function safeName(name?: string | null) {
    const s = (name || "").trim();
    if (!s) return "there";
    return s.slice(0, 40);
}

/* ----------------------------
   Clean, human HTML email
----------------------------- */
function buildJourneyHtml(args: {
    name?: string | null;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    unsubUrl: string;
}) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Kloner</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
          <tr>
            <td style="font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">
                Hey ${safeName(args.name)},
              </p>

              <p style="margin:0 0 20px 0;">
                ${args.body}
              </p>

              <p style="margin:0 0 24px 0;">
                <a href="${args.ctaUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">
                  ${args.ctaLabel}
                </a>
              </p>

              <p style="margin:0 0 28px 0;">
                If you get stuck or have feedback, just reply to this email — it goes straight to me.
              </p>

              <p style="margin:0 0 4px 0;">
                — Nolan
              </p>
              <p style="margin:0 0 24px 0;color:#6b7280;">
                Founder, Kloner
              </p>

              <p style="font-size:12px;color:#9ca3af;">
                <a href="${args.unsubUrl}" style="color:#9ca3af;text-decoration:underline;">
                  Disable these emails
                </a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildJourneyText(args: {
    name?: string | null;
    body: string;
    ctaUrl: string;
    unsubUrl: string;
}) {
    return `Hey ${safeName(args.name)},

${args.body}

Continue here:
${args.ctaUrl}

— Nolan
Founder, Kloner

Disable these emails:
${args.unsubUrl}`;
}

type JourneyState = {
    hasUrlScan: boolean;
    hasRender: boolean;
    hasVercelIntegration: boolean;
    hasStripeCustomer: boolean;
};

async function getJourneyState(db: FirebaseFirestore.Firestore, uid: string): Promise<JourneyState> {
    const userRef = db.collection("kloner_users").doc(uid);

    const [userSnap, urlsSnap, rendersSnap, integrationsSnap] = await Promise.all([
        userRef.get(),
        userRef.collection("kloner_urls").limit(1).get(),
        userRef.collection("kloner_renders").limit(1).get(),
        userRef.collection("integrations").limit(1).get(),
    ]);

    const user = userSnap.exists ? userSnap.data() : null;
    const stripeCustomerId =
        typeof user?.stripeCustomerId === "string" ? user.stripeCustomerId : "";

    return {
        hasUrlScan: !urlsSnap.empty,
        hasRender: !rendersSnap.empty,
        hasVercelIntegration: !integrationsSnap.empty,
        hasStripeCustomer: !!stripeCustomerId && stripeCustomerId.startsWith("cus_"),
    };
}

async function userHasAnyDeployment(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
    try {
        const snap = await db.collection("kloner_users").doc(uid).collection("deployments").limit(1).get();
        return !snap.empty;
    } catch {
        return false;
    }
}

function deriveTier(state: JourneyState): 1 | 2 | 3 | 4 {
    if (state.hasStripeCustomer) return 1;
    if (state.hasVercelIntegration) return 2;
    if (state.hasRender) return 3;
    return 4;
}

function makeCopy(tierNum: 1 | 2 | 3 | 4) {
    if (tierNum === 1) {
        return {
            body:
                "You were close to deploying but stopped at billing. If you want to ship something live, starting the trial gets you there fast.",
            ctaLabel: "Start trial",
            ctaPath: "/price",
            step: "paywall",
        };
    }
    if (tierNum === 2) {
        return {
            body:
                "You connected Vercel but haven’t deployed yet. One deploy is usually enough to make the whole thing click.",
            ctaLabel: "Open dashboard",
            ctaPath: "/dashboard",
            step: "vercel",
        };
    }
    if (tierNum === 3) {
        return {
            body:
                "You generated a render already. A couple of small edits and a deploy turns it into something real.",
            ctaLabel: "Continue editing",
            ctaPath: "/dashboard",
            step: "render",
        };
    }
    return {
        body:
            "If you still want to try Kloner, starting from a URL or template gets you a preview in minutes.",
        ctaLabel: "Open dashboard",
        ctaPath: "/dashboard",
        step: "start",
    };
}

function isCooldownElapsed(lastSentAt: number | null) {
    if (!lastSentAt) return true;
    return Date.now() - lastSentAt >= JOURNEY_EMAIL_COOLDOWN_MS;
}

function ensureUnsubToken(existing?: string | null) {
    const s = (existing || "").trim();
    if (s.length >= 24) return s;
    return crypto.randomBytes(18).toString("base64url");
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function pickJourneySubject(args: { uid: string; step: string }) {
    const subjectsByStep: Record<string, string[]> = {
        paywall: [
            "Want to ship this live?",
            "One step away from going live",
            "Quick idea to get this deployed",
        ],
        vercel: [
            "Ready for your first deploy?",
            "Let’s get one deploy out",
            "Your Vercel setup is done — next step",
        ],
        render: [
            "A small tweak, then deploy",
            "You’re close — want to ship it?",
            "Turn that render into a live app",
        ],
        start: [
            "Want a fresh preview in minutes?",
            "Pick a URL and I’ll help you ship",
            "A quick path to a working preview",
        ],
    };

    const step = (args.step || "start").toLowerCase();
    const candidates = subjectsByStep[step] || subjectsByStep.start;

    // Deterministic rotation per user per day per step (avoids feeling like the same blast).
    const h = crypto.createHash("sha256").update(`${args.uid}:${dayKeyUtc()}:${step}`).digest();
    const idx = h[0] % candidates.length;
    return candidates[idx];
}

function pickJourneyBody(args: { uid: string; step: string; tier: 1 | 2 | 3 | 4 }) {
    const bodiesByStep: Record<string, string[]> = {
        paywall: [
            "If your goal is a live app, the fastest loop is: deploy something small, then iterate. Starting a trial unlocks the full deploy path so you can focus on product, not setup.",
            "A lot of people get stuck right before the ‘live’ moment. The quickest way through is to ship one tiny deploy, then improve it. Trial → deploy → iterate.",
            "If you want to keep momentum, aim for one simple deploy first. Once it’s live, everything else (polish, features, SEO) becomes way easier to reason about.",
        ],
        vercel: [
            "You’ve already done the hard part by connecting Vercel. Next, push a simple deploy — even a boring one — just to establish the workflow. After that, editing feels 10× faster.",
            "A small tip: treat your first deploy as a ‘hello world’ for the pipeline. Once you’ve seen it live, you can focus on the parts that matter (copy, UX, features).",
            "If you’re feeling stuck, do a single deploy to validate the loop end-to-end. You can always refactor later — the big win is making it real.",
        ],
        render: [
            "Nice — you’ve got a render. The next win is turning it into something you can share. One or two small edits + a deploy is usually enough to unlock the ‘this is real’ feeling.",
            "Here’s the shortcut: don’t perfect it in the editor. Get it live, then iterate with real feedback. Shipping early makes every next decision easier.",
            "If you want momentum, pick one small change (headline, CTA, layout), then deploy. Small cycles beat big rewrites.",
        ],
        start: [
            "If you want a quick win, start from a URL or template and aim for a usable preview first. Kloner is best when it removes the setup so you can spend your time on the actual product.",
            "A simple approach that works: clone → tweak the key sections → deploy. You’ll get more clarity from something live than from another hour of setup.",
            "If you’re not sure what to build first, start by cloning the flow you want (landing → signup → dashboard). Once the skeleton exists, filling it in is straightforward.",
        ],
    };

    const step = (args.step || "start").toLowerCase();
    const candidates = bodiesByStep[step] || bodiesByStep.start;

    // Deterministic rotation per user per day per step.
    const h = crypto
        .createHash("sha256")
        .update(`${args.uid}:${dayKeyUtc()}:${step}:body:t${args.tier}`)
        .digest();
    const idx = h[0] % candidates.length;
    return candidates[idx];
}

/**
 * Serialize Resend sends to respect 2 req/sec.
 * - Even if you later add parallelism, this keeps outbound sends spaced.
 * - Includes a small buffer (550ms) to avoid clock skew / retries.
 */
let resendNextAllowedAt = 0;

async function sendWithRateLimit(
    resend: ReturnType<typeof getResend>,
    payload: Parameters<ReturnType<typeof getResend>["emails"]["send"]>[0],
) {
    const now = Date.now();
    const waitMs = Math.max(0, resendNextAllowedAt - now);
    if (waitMs > 0) await sleep(waitMs);

    // Reserve the next slot before sending to avoid bursts if this function is reused.
    resendNextAllowedAt = Date.now() + RESEND_MIN_INTERVAL_MS;

    return resend.emails.send(payload);
}

export async function POST(req: NextRequest) {
    const denied = requireInternal(req);
    if (denied) {
        await captureCriticalEvent({
            source: "vercel",
            severity: "error",
            statusCode: 401,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "private.sendJourneyEmails.auth",
            message: "Unauthorized internal access",
            service: "internal-email",
            url: req.url,
        });
        return denied;
    }

    // Default to sending to real users.
    // Set EMAIL_SEND_MODE=test to run a safe test-only send to EMAIL_TEST_TO.
    const SEND_MODE = (process.env.EMAIL_SEND_MODE || "all").toLowerCase();
    const ONLY_TEST_EMAIL = SEND_MODE === "test";
    const TEST_TO = (process.env.EMAIL_TEST_TO || "nolan796@live.ca").trim().toLowerCase();

    // Which campaigns are allowed to run.
    const ENABLE_JOURNEY = (process.env.EMAIL_ENABLE_JOURNEY || "true").toLowerCase() !== "false";
    const ENABLE_PRODUCT_LAUNCH = (process.env.EMAIL_ENABLE_PRODUCT_LAUNCH || "true").toLowerCase() !== "false";

    try {
        const db = getAdminDb();
        const auth = getAdminAuth();
        const resend = getResend();

        // IMPORTANT: sender identity
        const from = (process.env.JOURNEY_EMAIL_FROM || "Nolan from Kloner <nolan@kloner.app>").trim();

        const usersSnap = await db.collection("kloner_users").get();

        let sent = 0;
        let sentJourney = 0;
        let sentProduct = 0;
        let skippedNoEmail = 0;
        let skippedPrefs = 0;
        let skippedHasDeployment = 0;
        let skippedCooldown = 0;
        let skippedAlreadySentCampaign = 0;
        let skippedQuota = 0;
        let errors = 0;

        const productCampaignId = "nextjs16_app_cloning_launch_2026_02";

        for (const doc of usersSnap.docs) {
            if (sent >= RESEND_DAILY_LIMIT) break;

            const uid = doc.id;
            const data = doc.data() || {};
            let email = typeof data.email === "string" ? data.email : "";
            const name = typeof data.name === "string" ? data.name : null;

            // Try to backfill email from Firebase Auth when missing.
            if (!email) {
                try {
                    const u = await auth.getUser(uid);
                    if (u?.email) {
                        email = u.email;
                        await doc.ref.set(
                            {
                                email: u.email,
                                emailLower: u.email.toLowerCase(),
                                emailUpdatedAtMs: Date.now(),
                            },
                            { merge: true },
                        );
                    }
                } catch {
                    // ignore
                }
            }

            if (!email) {
                skippedNoEmail++;
                continue;
            }

            const emailLower = email.trim().toLowerCase();
            // In test mode, ONLY send + record state for the test account.
            if (ONLY_TEST_EMAIL && emailLower !== TEST_TO) {
                continue;
            }

            const prefs = data.notificationPrefs || {};

            // Avoid spamming: at most one email per user per run.
            let didSendToUserThisRun = false;

            // -----------------
            // Campaign 1: Product launch (one-time)
            // -----------------
            if (
                ENABLE_PRODUCT_LAUNCH &&
                !didSendToUserThisRun &&
                sentProduct < MAX_PRODUCT_SENDS_PER_RUN &&
                prefs.productEmails !== false
            ) {
                const alreadySentAt = (data.emailCampaigns && (data.emailCampaigns as any)[productCampaignId]?.sentAtMs) || null;
                if (alreadySentAt) {
                    skippedAlreadySentCampaign++;
                } else {
                    const quotaOk = await consumeDailyQuota(db, 1);
                    if (!quotaOk) {
                        skippedQuota++;
                    } else {
                        const dest = buildUtmGeneric(`${baseUrl()}/dashboard`, {
                            source: "product_email",
                            campaign: productCampaignId,
                            content: "cta",
                        });
                        const clickUrl = makeClickUrl({ uid, campaign: productCampaignId, destUrl: dest, step: "cta" });
                        const unsubUrl = makeUnsubUrl({ uid, kind: "product" });
                        const to = ONLY_TEST_EMAIL ? TEST_TO : email;

                        const body =
                            "Quick update: you can now clone entire apps (not just pages) with our new Next.js 16 workflow. " +
                            "With the incredible power of Supabase, we'll connect you to your own database to continue building your app seamlessly. " +
                            "It’s much better for interactive sites, and gives you cleaner, more maintainable output, ideal for those needing a full-stack solution.";

                        const result = await sendWithRateLimit(resend, {
                            from,
                            to,
                            subject: "New: App cloning (Next.js 16) is live",
                            html: buildJourneyHtml({
                                name,
                                body,
                                ctaLabel: "Try app cloning",
                                ctaUrl: clickUrl,
                                unsubUrl,
                            }),
                            text: buildJourneyText({
                                name,
                                body,
                                ctaUrl: clickUrl,
                                unsubUrl,
                            }),
                            headers: {
                                "List-Unsubscribe": `<${unsubUrl}>`,
                            },
                        });

                        // best-effort store send metadata
                        const resendId = (result as any)?.data?.id ?? null;
                        await doc.ref.set(
                            {
                                emailCampaigns: {
                                    [productCampaignId]: {
                                        sentAtMs: Date.now(),
                                        to: ONLY_TEST_EMAIL ? TEST_TO : email,
                                        resendId,
                                    },
                                },
                            },
                            { merge: true },
                        );

                        sent++;
                        sentProduct++;
                        didSendToUserThisRun = true;
                    }
                }
            }

            // -----------------
            // Campaign 2: Journey nudge (only users w/ no deployments)
            // -----------------
            if (
                ENABLE_JOURNEY &&
                !didSendToUserThisRun &&
                sentJourney < MAX_JOURNEY_SENDS_PER_RUN &&
                prefs.journeyEmails !== false
            ) {
                const hasDeployment = await userHasAnyDeployment(db, uid);
                if (hasDeployment) {
                    skippedHasDeployment++;
                } else {
                    const lastSentAt = typeof data.lastJourneyEmailSentAt === "number" ? data.lastJourneyEmailSentAt : null;
                    if (!isCooldownElapsed(lastSentAt)) {
                        skippedCooldown++;
                    } else {
                        const quotaOk = await consumeDailyQuota(db, 1);
                        if (!quotaOk) {
                            skippedQuota++;
                        } else {
                            const state = await getJourneyState(db, uid);
                            const tierNum = deriveTier(state);
                            const copy = makeCopy(tierNum);
                            const body = pickJourneyBody({ uid, step: copy.step, tier: tierNum });

                            const unsubUrl = makeUnsubUrl({ uid, kind: "journey" });
                            const dest = buildUtm(
                                `${baseUrl()}${copy.ctaPath}`,
                                tierNum,
                                copy.step,
                            );
                            const clickUrl = makeClickUrl({ uid, campaign: "journey_nudge", destUrl: dest, step: copy.step });
                            const to = ONLY_TEST_EMAIL ? TEST_TO : email;

                            await sendWithRateLimit(resend, {
                                from,
                                to,
                                subject: pickJourneySubject({ uid, step: copy.step }),
                                html: buildJourneyHtml({
                                    name,
                                    body,
                                    ctaLabel: copy.ctaLabel,
                                    ctaUrl: clickUrl,
                                    unsubUrl,
                                }),
                                text: buildJourneyText({
                                    name,
                                    body,
                                    ctaUrl: clickUrl,
                                    unsubUrl,
                                }),
                                headers: {
                                    "List-Unsubscribe": `<${unsubUrl}>`,
                                },
                            });

                            await doc.ref.set(
                                {
                                    lastJourneyEmailSentAt: Date.now(),
                                    lastJourneyEmailTier: tierNum,
                                    lastJourneyEmailStep: copy.step,
                                },
                                { merge: true },
                            );

                            sent++;
                            sentJourney++;
                            didSendToUserThisRun = true;
                        }
                    }
                }
            }

            if (!didSendToUserThisRun) {
                // Track prefs skips for observability
                if (prefs.journeyEmails === false || prefs.productEmails === false) skippedPrefs++;
            }
        }

        return NextResponse.json(
            {
                ok: true,
                mode: ONLY_TEST_EMAIL ? "test" : "all",
                sent,
                sentJourney,
                sentProduct,
                skipped: {
                    noEmail: skippedNoEmail,
                    prefs: skippedPrefs,
                    hasDeployment: skippedHasDeployment,
                    cooldown: skippedCooldown,
                    alreadySentCampaign: skippedAlreadySentCampaign,
                    quota: skippedQuota,
                },
                errors,
            },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (err: any) {
        console.error("send-journey-emails failed:", err);
        await captureException({
            source: "vercel",
            error: err,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "private.sendJourneyEmails.run",
            statusCode: 500,
            service: "internal-email",
            url: req.url,
        });
        return NextResponse.json(
            { error: err?.message || "Internal error" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
        );
    }
}
