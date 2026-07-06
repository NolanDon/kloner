import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminAuth, getAdminDb, verifySession } from "../../_lib/auth";
import { makeRecoveryCheckoutUrl, makeUnsubUrl } from "@/app/api/private/email-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const RECOVERY_SENDER = "Kloner Team <hello@kloner.app>";

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function buildRecoveryOfferHtml(args: { name?: string | null; linkUrl: string; unsubUrl: string }) {
    const safeName = (args.name || "there").trim() || "there";
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Open for a surprise</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
            <td align="center" style="padding:40px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
                    <tr>
                        <td style="font-size:15px;line-height:1.65;">
                            <p style="margin:0 0 16px 0;">Hey ${safeName},</p>
                            <p style="margin:0 0 16px 0;">I saw you were close to checkout. If price was the blocker, here’s 40% off your first month.</p>
                            <p style="margin:0 0 24px 0;">
                                <a href="${args.linkUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">Get 40% off now</a>
                            </p>
                            <p style="margin:0 0 16px 0;color:#6b7280;font-size:13px;">This is a journey email. <a href="${args.unsubUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe from these emails</a>.</p>
                            <p style="margin:0 0 20px 0;">We’re always here to help get your project started.</p>
                            <p style="margin:0 0 24px 0;color:#6b7280;">— The Kloner team</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

function buildRecoveryOfferText(args: { name?: string | null; linkUrl: string; unsubUrl: string }) {
    const safeName = (args.name || "there").trim() || "there";
    return `Hey ${safeName},

I saw you were close to checkout. If price was the blocker, here’s 40% off your first month.

Get 40% off now:
${args.linkUrl}

This is a journey email. Unsubscribe from these emails:
${args.unsubUrl}

We’re always here to help get your project started.

— The Kloner team`;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            const decoded = await verifySession(req);
            const db = getAdminDb();
            const userRef = db.collection("kloner_users").doc(decoded.uid);
            const snap = await userRef.get();
            const userData = snap.exists ? (snap.data() as any) : {};
            const prefs = (userData?.notificationPrefs || {}) as any;

            if (prefs?.journeyEmails === false) {
                return NextResponse.json({ ok: true, sent: false, skipped: "unsubscribed" }, { headers: { "Cache-Control": "no-store" } });
            }

            const sentAt = userData?.offers?.exitOffer40RecoveryEmailSentAt || userData?.["offers.exitOffer40RecoveryEmailSentAt"];
            if (sentAt) {
                return NextResponse.json({ ok: true, sent: false, skipped: "already_sent" }, { headers: { "Cache-Control": "no-store" } });
            }

            const authUser = await getAdminAuth().getUser(decoded.uid);
            const email = authUser.email?.trim() || "";
            if (!email) {
                return NextResponse.json({ ok: true, sent: false, skipped: "missing_email" }, { headers: { "Cache-Control": "no-store" } });
            }

            await userRef.set(
                {
                    offers: {
                        ...(userData?.offers && typeof userData.offers === "object" ? userData.offers : {}),
                        exitOffer40RecoveryEmailSentAt: Date.now(),
                    },
                },
                { merge: true },
            );

            const from = process.env.WELCOME_EMAIL_FROM || RECOVERY_SENDER;
            const linkUrl = makeRecoveryCheckoutUrl({ uid: decoded.uid, kind: "exit40" });
            const unsubUrl = makeUnsubUrl({ uid: decoded.uid, kind: "journey" });
            const resend = getResend();
            const result = await resend.emails.send({
                from,
                to: email,
                subject: "Open for a surprise",
                text: buildRecoveryOfferText({ name: authUser.displayName || null, linkUrl, unsubUrl }),
                html: buildRecoveryOfferHtml({ name: authUser.displayName || null, linkUrl, unsubUrl }),
            });

            if (result && typeof result === "object" && "error" in result && (result as any).error) {
                throw new Error(((result as any).error?.message as string) || "Recovery email send failed");
            }

            return NextResponse.json({ ok: true, sent: true }, { headers: { "Cache-Control": "no-store" } });
        },
        { methods: ["POST"], csrf: true },
    );
}
