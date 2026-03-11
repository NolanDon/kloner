import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "node:crypto";
import { getAdminAuth, getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const FIRST_URL_CAMPAIGN_ID = "first_url_next_steps_2026_03";
const BACKFILL_DEFAULT_LIMIT = 10;
const BACKFILL_MAX_LIMIT = 25;
const RESEND_MIN_INTERVAL_MS = 550;
const CAMPAIGN_PENDING_TTL_MS = 10 * 60 * 1000;

let resendNextAllowedAt = 0;

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function sendWithRateLimit(
    resend: ReturnType<typeof getResend>,
    payload: Parameters<ReturnType<typeof getResend>["emails"]["send"]>[0],
) {
    const now = Date.now();
    const waitMs = Math.max(0, resendNextAllowedAt - now);
    if (waitMs > 0) await sleep(waitMs);
    resendNextAllowedAt = Date.now() + RESEND_MIN_INTERVAL_MS;
    return resend.emails.send(payload);
}

function hasValidInternalKey(req: NextRequest): boolean {
    const expected = (process.env.INTERNAL_API_KEY || "").trim();
    const got = (req.headers.get("x-internal-key") || "").trim();
    return !!expected && got === expected;
}

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function baseUrl() {
    const v = (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
    if (v) return v.replace(/\/$/, "");
    return "https://kloner.app";
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
    try {
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
    } catch {
        return params.destUrl;
    }
}

function makeUnsubUrl(params: { uid: string; kind: "journey" | "product" | "all" }) {
    try {
        const u = new URL(`${baseUrl()}/api/email/unsubscribe`);
        const token = makeSignedToken({ uid: params.uid, k: params.kind, ts: Date.now() });
        u.searchParams.set("t", token);
        return u.toString();
    } catch {
        return `${baseUrl()}/dashboard/settings`;
    }
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

function normalizePublicHttpUrl(raw: unknown): string | null {
    const input = String(raw || "").trim();
    if (!input) return null;
    try {
        const u = new URL(input);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        if (!u.hostname || !u.hostname.includes(".")) return null;
        u.hash = "";
        const out = u.toString();
        if (u.pathname === "/" && !u.search) {
            return out.replace(/\/$/, "");
        }
        return out;
    } catch {
        return null;
    }
}

function buildFirstUrlNextStepsHtml(args: {
    name?: string | null;
    ctaUrl: string;
    unsubUrl: string;
}) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Next steps in Kloner</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
          <tr>
            <td style="font-size:15px;line-height:1.65;">
              <p style="margin:0 0 16px 0;">Hey ${safeName(args.name)},</p>

              <p style="margin:0 0 16px 0;">
                Great start. You have added your first URL. Now the best move is to generate your first website.
              </p>

              <p style="margin:0 0 10px 0;font-weight:600;">Choose one path:</p>

              <div style="margin:0 0 14px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;">
                <div style="font-weight:700;margin:0 0 6px 0;">1) Website (Next.js)</div>
                <div style="margin:0;color:#374151;">
                  Best for complex websites with users, products, dashboards, auth, and stored data.
                  You edit through the AI agent end-to-end. No manual quick-tweak editor in this flow.
                </div>
              </div>

              <div style="margin:0 0 16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;">
                <div style="font-weight:700;margin:0 0 6px 0;">2) Simple Landing Website (HTML)</div>
                <div style="margin:0;color:#374151;">
                  Best for basic landing pages and brochure sites.
                  This opens the manual editor for quick tweaks like copy, colors, and layout details.
                </div>
              </div>

              <p style="margin:0 0 20px 0;">
                If you are unsure, start with HTML for speed. Choose Next.js if you need app-like features and data.
              </p>

              <p style="margin:0 0 24px 0;">
                <a href="${args.ctaUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">
                  Choose your build path
                </a>
              </p>

              <p style="margin:0 0 28px 0;">
                If you get stuck, reply to this email and I will help you pick the fastest path.
              </p>

              <p style="margin:0 0 4px 0;">— Nolan</p>
              <p style="margin:0 0 24px 0;color:#6b7280;">Founder, Kloner</p>

              <p style="font-size:12px;color:#9ca3af;">
                <a href="${args.unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Disable these emails</a>
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

function buildFirstUrlNextStepsText(args: {
    name?: string | null;
    ctaUrl: string;
    unsubUrl: string;
}) {
    return `Hey ${safeName(args.name)},

Great start. You have added your first URL. Now the best move is to generate your first website.

Choose one path:

1) Website (Next.js)
Best for complex websites with users, products, dashboards, auth, and stored data.
You edit through the AI agent end-to-end. No manual quick-tweak editor in this flow.

2) Simple Landing Website (HTML)
Best for basic landing pages and brochure sites.
This opens the manual editor for quick tweaks like copy, colors, and layout details.

If you are unsure, start with HTML for speed. Choose Next.js if you need app-like features and data.

Choose your build path:
${args.ctaUrl}

— Nolan
Founder, Kloner

Disable these emails:
${args.unsubUrl}`;
}

function toMillis(raw: any): number {
    if (!raw) return 0;
    if (typeof raw?.toMillis === "function") {
        const v = raw.toMillis();
        return Number.isFinite(v) ? v : 0;
    }
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) ? parsed : 0;
}

async function getFirstUrlState(db: FirebaseFirestore.Firestore, uid: string) {
    const userRef = db.collection("kloner_users").doc(uid);
    const [urlsSnap, rendersSnap, appsSnap] = await Promise.all([
        userRef.collection("kloner_urls").limit(1).get(),
        userRef.collection("kloner_renders").limit(1).get(),
        userRef.collection("kloner_apps").limit(1).get(),
    ]);

    return {
        hasUrlScan: !urlsSnap.empty,
        hasRender: !rendersSnap.empty,
        hasApp: !appsSnap.empty,
    };
}

type SendAttempt =
    | { status: "sent" }
    | { status: "skipped"; reason: string };

async function claimFirstUrlCampaignSlot(args: {
    db: FirebaseFirestore.Firestore;
    userRef: FirebaseFirestore.DocumentReference;
    source: "event" | "backfill";
}): Promise<boolean> {
    const now = Date.now();
    return args.db.runTransaction(async (tx) => {
        const snap = await tx.get(args.userRef);
        const data = (snap.exists ? snap.data() : {}) as Record<string, any>;
        const existing =
            (data?.emailCampaigns && (data.emailCampaigns as any)[FIRST_URL_CAMPAIGN_ID]) || null;

        const sentAtMs = typeof existing?.sentAtMs === "number" ? existing.sentAtMs : 0;
        if (sentAtMs > 0) return false;

        const pendingClaimedAtMs = typeof existing?.claimedAtMs === "number" ? existing.claimedAtMs : 0;
        const isPending = existing?.status === "pending";
        if (isPending && pendingClaimedAtMs > 0 && now - pendingClaimedAtMs < CAMPAIGN_PENDING_TTL_MS) {
            return false;
        }

        tx.set(
            args.userRef,
            {
                emailCampaigns: {
                    [FIRST_URL_CAMPAIGN_ID]: {
                        status: "pending",
                        claimedAtMs: now,
                        source: args.source,
                    },
                },
            },
            { merge: true },
        );
        return true;
    });
}

async function resolveUserEmail(args: {
    auth: ReturnType<typeof getAdminAuth>;
    userRef: FirebaseFirestore.DocumentReference;
    uid: string;
    data: Record<string, any>;
}): Promise<string> {
    let email = typeof args.data.email === "string" ? args.data.email.trim() : "";
    if (email) return email;

    try {
        const user = await args.auth.getUser(args.uid);
        if (user?.email) {
            email = user.email;
            await args.userRef.set(
                {
                    email,
                    emailLower: email.toLowerCase(),
                    emailUpdatedAtMs: Date.now(),
                },
                { merge: true },
            );
        }
    } catch {
        // ignore auth lookup failures here
    }

    return email;
}

async function sendFirstUrlEmailForUser(args: {
    db: FirebaseFirestore.Firestore;
    resend: ReturnType<typeof getResend>;
    from: string;
    uid: string;
    email: string;
    name?: string | null;
    userRef: FirebaseFirestore.DocumentReference;
    userData: Record<string, any>;
    targetUrlCanonical?: string | null;
    source: "event" | "backfill";
}): Promise<SendAttempt> {
    const prefs = args.userData.notificationPrefs || {};
    if (prefs.journeyEmails === false) {
        return { status: "skipped", reason: "journey_disabled" };
    }

    const alreadySentAt =
        (args.userData.emailCampaigns && (args.userData.emailCampaigns as any)[FIRST_URL_CAMPAIGN_ID]?.sentAtMs) || null;
    if (alreadySentAt) {
        return { status: "skipped", reason: "already_sent" };
    }

    const state = await getFirstUrlState(args.db, args.uid);
    if (!state.hasUrlScan) {
        return { status: "skipped", reason: "no_url" };
    }
    if (state.hasRender || state.hasApp) {
        return { status: "skipped", reason: "already_generated" };
    }

    if (args.targetUrlCanonical) {
        const q = await args.userRef
            .collection("kloner_urls")
            .where("url", "==", args.targetUrlCanonical)
            .limit(1)
            .get();
        if (q.empty) {
            return { status: "skipped", reason: "target_url_not_found" };
        }

        const urlData = (q.docs[0]?.data() || {}) as Record<string, any>;
        const rawStatus = String(urlData.status || "").toLowerCase();
        const screenshotPathCount = Array.isArray(urlData.screenshotPaths) ? urlData.screenshotPaths.length : 0;
        const screenshotMetaCount = Array.isArray(urlData.screenshots) ? urlData.screenshots.length : 0;
        const hasScreenshots = screenshotPathCount + screenshotMetaCount > 0;
        const isReadyLike = rawStatus === "ready" || rawStatus === "done" || rawStatus === "uploaded";

        if (!isReadyLike && !hasScreenshots) {
            return { status: "skipped", reason: "target_url_not_ready" };
        }
    }

    const claimed = await claimFirstUrlCampaignSlot({
        db: args.db,
        userRef: args.userRef,
        source: args.source,
    });
    if (!claimed) {
        return { status: "skipped", reason: "already_sent" };
    }

    const dest = buildUtmGeneric(`${baseUrl()}/dashboard/view`, {
        source: "journey_email",
        campaign: FIRST_URL_CAMPAIGN_ID,
        content: "next_steps",
    });
    const clickUrl = makeClickUrl({ uid: args.uid, campaign: FIRST_URL_CAMPAIGN_ID, destUrl: dest, step: "next_steps" });
    const unsubUrl = makeUnsubUrl({ uid: args.uid, kind: "journey" });

    let result: any;
    try {
        result = await sendWithRateLimit(args.resend, {
            from: args.from,
            to: args.email,
            subject: "🎉 You added your first URL — here is what to do next",
            html: buildFirstUrlNextStepsHtml({
                name: args.name,
                ctaUrl: clickUrl,
                unsubUrl,
            }),
            text: buildFirstUrlNextStepsText({
                name: args.name,
                ctaUrl: clickUrl,
                unsubUrl,
            }),
            headers: {
                "List-Unsubscribe": `<${unsubUrl}>`,
            },
        });
    } catch (err: any) {
        await args.userRef.set(
            {
                emailCampaigns: {
                    [FIRST_URL_CAMPAIGN_ID]: {
                        status: "failed",
                        failedAtMs: Date.now(),
                        source: args.source,
                        lastError: String(err?.message || "send_failed").slice(0, 240),
                    },
                },
            },
            { merge: true },
        );
        return { status: "skipped", reason: "send_failed" };
    }

    const resendId = (result as any)?.data?.id ?? null;
    await args.userRef.set(
        {
            emailCampaigns: {
                [FIRST_URL_CAMPAIGN_ID]: {
                    sentAtMs: Date.now(),
                    to: args.email,
                    resendId,
                    source: args.source,
                    status: "sent",
                },
            },
        },
        { merge: true },
    );

    return { status: "sent" };
}

async function runBackfill(body?: { limit?: number }) {
    const db = getAdminDb();
    const auth = getAdminAuth();
    const resend = getResend();
    const from = (process.env.JOURNEY_EMAIL_FROM || "Nolan from Kloner <nolan@kloner.app>").trim();

    let limit = BACKFILL_DEFAULT_LIMIT;
    const rawLimit = Number(body?.limit);
    if (Number.isFinite(rawLimit) && rawLimit > 0) {
        limit = Math.min(BACKFILL_MAX_LIMIT, Math.floor(rawLimit));
    }

    const usersSnap = await db.collection("kloner_users").get();
    const docs = usersSnap.docs.slice().sort((a, b) => {
        const at = toMillis((a.data() || {}).createdAt);
        const bt = toMillis((b.data() || {}).createdAt);
        return bt - at;
    });

    let sent = 0;
    let skippedNoEmail = 0;
    let skippedAlreadySent = 0;
    let skippedNotEligible = 0;
    let skippedPrefs = 0;

    for (const d of docs) {
        if (sent >= limit) break;

        const uid = d.id;
        const data = (d.data() || {}) as Record<string, any>;
        const name = typeof data.name === "string" ? data.name : null;

        const prefs = data.notificationPrefs || {};
        if (prefs.journeyEmails === false) {
            skippedPrefs++;
            continue;
        }

        const userRef = db.collection("kloner_users").doc(uid);
        const email = await resolveUserEmail({ auth, userRef, uid, data });
        if (!email) {
            skippedNoEmail++;
            continue;
        }

        const result = await sendFirstUrlEmailForUser({
            db,
            resend,
            from,
            uid,
            email,
            name,
            userRef,
            userData: data,
            source: "backfill",
        });

        if (result.status === "sent") {
            sent++;
            continue;
        }

        if (result.reason === "already_sent") skippedAlreadySent++;
        else if (result.reason === "journey_disabled") skippedPrefs++;
        else skippedNotEligible++;
    }

    return NextResponse.json(
        {
            ok: true,
            mode: "backfill",
            campaignId: FIRST_URL_CAMPAIGN_ID,
            requestedLimit: limit,
            sent,
            skipped: {
                noEmail: skippedNoEmail,
                alreadySent: skippedAlreadySent,
                notEligible: skippedNotEligible,
                prefs: skippedPrefs,
            },
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}

async function runInternalTestSend(args: { testTo: string; name?: string }) {
    const resend = getResend();
    const from = (process.env.JOURNEY_EMAIL_FROM || "Nolan from Kloner <nolan@kloner.app>").trim();
    const to = String(args.testTo || "").trim().toLowerCase();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
    if (!isValidEmail) {
        return NextResponse.json(
            { ok: false, error: "Invalid test email" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
        );
    }

    const dest = buildUtmGeneric(`${baseUrl()}/dashboard/view`, {
        source: "journey_email",
        campaign: `${FIRST_URL_CAMPAIGN_ID}_test`,
        content: "next_steps",
    });
    const unsubUrl = `${baseUrl()}/dashboard/settings`;

    await sendWithRateLimit(resend, {
        from,
        to,
        subject: "[TEST] 🎉 You added your first URL — here is what to do next",
        html: buildFirstUrlNextStepsHtml({
            name: args.name || "Nolan",
            ctaUrl: dest,
            unsubUrl,
        }),
        text: buildFirstUrlNextStepsText({
            name: args.name || "Nolan",
            ctaUrl: dest,
            unsubUrl,
        }),
    });

    return NextResponse.json(
        {
            ok: true,
            mode: "test-send",
            to,
            campaignId: FIRST_URL_CAMPAIGN_ID,
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}

export async function POST(req: NextRequest) {
    if (hasValidInternalKey(req)) {
        try {
            const body = (await req.json().catch(() => ({} as any))) as {
                limit?: number;
                testTo?: string;
                name?: string;
            };

            if (typeof body.testTo === "string" && body.testTo.trim()) {
                return await runInternalTestSend({
                    testTo: body.testTo,
                    name: body.name,
                });
            }

            return await runBackfill({ limit: body.limit });
        } catch (err: any) {
            return NextResponse.json(
                { error: err?.message || "Backfill failed" },
                { status: 500, headers: { "Cache-Control": "no-store" } },
            );
        }
    }

    return requireSessionAndMaybeCsrf(
        req,
        async ({ req, uid }) => {
            const db = getAdminDb();
            const auth = getAdminAuth();
            const resend = getResend();
            const from = (process.env.JOURNEY_EMAIL_FROM || "Nolan from Kloner <nolan@kloner.app>").trim();

            const body = (await req.json().catch(() => ({} as any))) as { url?: string };
            const targetUrlCanonical = normalizePublicHttpUrl(body?.url || "");

            const userRef = db.collection("kloner_users").doc(uid);
            const userSnap = await userRef.get();
            const data = (userSnap.exists ? userSnap.data() : {}) as Record<string, any>;
            const name = typeof data?.name === "string" ? data.name : null;

            const email = await resolveUserEmail({ auth, userRef, uid, data });
            if (!email) {
                return NextResponse.json(
                    { ok: false, error: "Missing email" },
                    { status: 400, headers: { "Cache-Control": "no-store" } },
                );
            }

            const result = await sendFirstUrlEmailForUser({
                db,
                resend,
                from,
                uid,
                email,
                name,
                userRef,
                userData: data,
                targetUrlCanonical,
                source: "event",
            });

            return NextResponse.json(
                {
                    ok: true,
                    campaignId: FIRST_URL_CAMPAIGN_ID,
                    ...result,
                },
                { headers: { "Cache-Control": "no-store" } },
            );
        },
        { methods: ["POST"], csrf: true },
    );
}
