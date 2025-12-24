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

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function requireInternal(req: NextRequest) {
    const key = process.env.INTERNAL_CRON_KEY || "";
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

function buildJourneyHtml(args: {
    email: string;
    name?: string | null;
    tierNum: 1 | 2 | 3 | 4;
    headline: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    unsubUrl: string;
}) {
    const accent = "#f55f2a";
    const dark = "#111827";
    const muted = "#6b7280";

    return `<!doctype html>
<html lang="en">
<head><meta charSet="utf-8" /><title>${args.headline}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border:1px solid #fee2d5;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:18px 24px;background:${accent};">
              <div style="font-size:16px;font-weight:700;color:#ffffff;">${args.headline}</div>
              <div style="font-size:12px;color:#ffe7dc;margin-top:2px;">Journey step · Tier ${args.tierNum}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <p style="margin:0 0 10px 0;font-size:14px;color:${dark};">Hi ${safeName(args.name)},</p>
              <p style="margin:0 0 12px 0;font-size:13px;color:${muted};line-height:1.6;">${args.body}</p>
              <a href="${args.ctaUrl}" style="display:inline-block;margin-top:12px;background:${accent};color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:999px;">
                ${args.ctaLabel}
              </a>
              <p style="margin-top:16px;font-size:12px;color:${muted};">
                <a href="${args.unsubUrl}" style="color:${accent};text-decoration:none;font-weight:600;">Disable these emails</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px;background:#fff7f3;font-size:11px;color:#9ca3af;">
              Sent to ${args.email}
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
    return `Hi ${safeName(args.name)},

${args.body}

Continue here:
${args.ctaUrl}

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
            headline: "Finish setup and ship your first deploy",
            body:
                "You reached the billing step. Start your trial and deploy once to lock in the workflow.",
            ctaLabel: "Start 7 day trial",
            ctaPath: "/price",
            step: "paywall",
        };
    }
    if (tierNum === 2) {
        return {
            headline: "Your Vercel is connected",
            body:
                "Deploy one preview to get a live link and complete the loop.",
            ctaLabel: "Open deployments",
            ctaPath: "/dashboard",
            step: "vercel",
        };
    }
    if (tierNum === 3) {
        return {
            headline: "You generated a render",
            body:
                "Make one small edit and deploy a version 1.",
            ctaLabel: "Continue editing",
            ctaPath: "/dashboard",
            step: "render",
        };
    }
    return {
        headline: "Start with a URL or a template",
        body:
            "Paste a public URL or start from a community template to generate your first preview.",
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

export async function POST(req: NextRequest) {
    const denied = requireInternal(req);
    if (denied) return denied;

    const ONLY_TEST_EMAIL = true;
    const TEST_TO = "nolan796@live.ca";

    try {
        const db = getAdminDb();
        const resend = getResend();
        const from = process.env.MARKETING_EMAIL_FROM || "hello@kloner.app";

        const usersSnap = await db.collection("kloner_users").get();

        let attempted = 0;
        let sent = 0;
        let skipped = 0;

        for (const doc of usersSnap.docs) {
            attempted++;

            const uid = doc.id;
            const data = doc.data() || {};
            const email = typeof data.email === "string" ? data.email : "";
            const name = typeof data.name === "string" ? data.name : null;

            if (!email) {
                skipped++;
                continue;
            }

            const prefs = data.notificationPrefs || {};
            const journeyOn =
                typeof prefs.journeyEmails === "boolean" ? prefs.journeyEmails : true;

            if (!journeyOn) {
                skipped++;
                continue;
            }

            const lastSentAt =
                typeof data.lastJourneyEmailSentAt === "number"
                    ? data.lastJourneyEmailSentAt
                    : null;

            if (!isCooldownElapsed(lastSentAt)) {
                skipped++;
                continue;
            }

            const state = await getJourneyState(db, uid);
            const tierNum = deriveTier(state);
            const copy = makeCopy(tierNum);

            const unsubToken = ensureUnsubToken(
                typeof data.notificationUnsubToken === "string"
                    ? data.notificationUnsubToken
                    : null,
            );

            if (unsubToken !== data.notificationUnsubToken) {
                await doc.ref.set({ notificationUnsubToken: unsubToken }, { merge: true });
            }

            const ctaUrl = buildUtm(
                `https://kloner.app${copy.ctaPath}`,
                tierNum,
                copy.step,
            );

            const unsubUrl = buildUtm(
                `https://kloner.app/s/unsub?uid=${encodeURIComponent(uid)}&t=${encodeURIComponent(unsubToken)}`,
                tierNum,
                "unsub",
            );

            const to = ONLY_TEST_EMAIL ? TEST_TO : email;

            const html = buildJourneyHtml({
                email: to,
                name,
                tierNum,
                headline: copy.headline,
                body: copy.body,
                ctaLabel: copy.ctaLabel,
                ctaUrl,
                unsubUrl,
            });

            const text = buildJourneyText({
                name,
                body: copy.body,
                ctaUrl,
                unsubUrl,
            });

            const result = await resend.emails.send({
                from,
                to,
                subject: copy.headline,
                html,
                text,
            });

            if ("error" in result && result.error) {
                console.error("Resend error:", result.error);
                skipped++;
                continue;
            }

            sent++;

            await doc.ref.set(
                {
                    lastJourneyEmailSentAt: Date.now(),
                    lastJourneyEmailTier: tierNum,
                    lastJourneyEmailStep: copy.step,
                },
                { merge: true },
            );
        }

        return NextResponse.json(
            { ok: true, attempted, sent, skipped },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (err: any) {
        console.error("send-journey-emails failed:", err);
        return NextResponse.json(
            { error: err?.message || "Internal error" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
        );
    }
}
