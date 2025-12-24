// app/api/private/send-journey-emails/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb } from "../../_lib/auth";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const JOURNEY_EMAIL_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours

// Resend limit: 2 req / second
const RESEND_MIN_INTERVAL_MS = 550;

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
    if (denied) return denied;

    const ONLY_TEST_EMAIL = true;
    const TEST_TO = "nolan796@live.ca";

    try {
        const db = getAdminDb();
        const resend = getResend();

        // IMPORTANT: sender identity
        const from = "Nolan from Kloner <hello@kloner.app>";

        const usersSnap = await db.collection("kloner_users").get();

        for (const doc of usersSnap.docs) {
            const uid = doc.id;
            const data = doc.data() || {};
            const email = typeof data.email === "string" ? data.email : "";
            const name = typeof data.name === "string" ? data.name : null;

            if (!email) continue;

            const prefs = data.notificationPrefs || {};
            if (prefs.journeyEmails === false) continue;

            const lastSentAt =
                typeof data.lastJourneyEmailSentAt === "number"
                    ? data.lastJourneyEmailSentAt
                    : null;

            if (!isCooldownElapsed(lastSentAt)) continue;

            const state = await getJourneyState(db, uid);
            const tierNum = deriveTier(state);
            const copy = makeCopy(tierNum);

            const unsubToken = ensureUnsubToken(data.notificationUnsubToken);
            if (unsubToken !== data.notificationUnsubToken) {
                await doc.ref.set({ notificationUnsubToken: unsubToken }, { merge: true });
            }

            const ctaUrl = buildUtm(
                `https://kloner.app${copy.ctaPath}`,
                tierNum,
                copy.step,
            );

            const unsubUrl = buildUtm(
                `https://kloner.app/dashboard/settings?tab=notifications&uid=${encodeURIComponent(uid)}&t=${encodeURIComponent(unsubToken)}`,
                tierNum,
                "unsub",
            );

            const to = ONLY_TEST_EMAIL ? TEST_TO : email;

            await sendWithRateLimit(resend, {
                from,
                to,
                subject: "Quick note from Nolan",
                html: buildJourneyHtml({
                    name,
                    body: copy.body,
                    ctaLabel: copy.ctaLabel,
                    ctaUrl,
                    unsubUrl,
                }),
                text: buildJourneyText({
                    name,
                    body: copy.body,
                    ctaUrl,
                    unsubUrl,
                }),
            });

            await doc.ref.set(
                {
                    lastJourneyEmailSentAt: Date.now(),
                    lastJourneyEmailTier: tierNum,
                    lastJourneyEmailStep: copy.step,
                },
                { merge: true },
            );
        }

        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err: any) {
        console.error("send-journey-emails failed:", err);
        return NextResponse.json(
            { error: err?.message || "Internal error" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
        );
    }
}
