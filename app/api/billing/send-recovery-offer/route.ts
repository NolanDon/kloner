import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminAuth, getAdminDb, verifySession } from "../../_lib/auth";
import { makeRecoveryCheckoutUrl, makeUnsubUrl } from "@/app/api/private/email-links";
import {
    canSendRecoveryOfferEmail,
    hasActiveOrTrialingStripeSubscription,
    hasLikelyActivePaidAccess,
} from "@/app/api/_lib/recoveryOffer";
import { buildRecoveryOfferEmail } from "@/app/api/_lib/recoveryOfferEmail";
import { getStripe } from "@/lib/stripe";

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

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            const decoded = await verifySession(req);
            const db = getAdminDb();
            const userRef = db.collection("kloner_users").doc(decoded.uid);
            const snap = await userRef.get();
            const userData = snap.exists ? (snap.data() as any) : {};
            const sentAt = userData?.offers?.exitOffer40RecoveryEmailSentAt || userData?.["offers.exitOffer40RecoveryEmailSentAt"];
            if (sentAt) {
                return NextResponse.json({ ok: true, sent: false, skipped: "already_sent" }, { headers: { "Cache-Control": "no-store" } });
            }

            const canSend = canSendRecoveryOfferEmail(userData);
            if (!canSend.ok) {
                return NextResponse.json(
                    {
                        ok: true,
                        sent: false,
                        skipped: canSend.reason || "inactive",
                    },
                    { headers: { "Cache-Control": "no-store" } }
                );
            }

            if (hasLikelyActivePaidAccess(userData)) {
                return NextResponse.json(
                    { ok: true, sent: false, skipped: "active_subscription" },
                    { headers: { "Cache-Control": "no-store" } }
                );
            }

            const customerId =
                typeof userData?.stripeCustomerId === "string" && userData.stripeCustomerId.trim()
                    ? userData.stripeCustomerId.trim()
                    : null;
            if (customerId) {
                const stripe = getStripe();
                const hasActiveSub = await hasActiveOrTrialingStripeSubscription(stripe, customerId).catch(() => false);
                if (hasActiveSub) {
                    return NextResponse.json(
                        { ok: true, sent: false, skipped: "active_subscription" },
                        { headers: { "Cache-Control": "no-store" } }
                    );
                }
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
            const offer = buildRecoveryOfferEmail({
                name: authUser.displayName || null,
                linkUrl,
                unsubUrl,
                variant: "checkout",
            });
            const resend = getResend();
            const result = await resend.emails.send({
                from,
                to: email,
                subject: offer.subject,
                text: offer.text,
                html: offer.html,
            });

            if (result && typeof result === "object" && "error" in result && (result as any).error) {
                throw new Error(((result as any).error?.message as string) || "Recovery email send failed");
            }

            return NextResponse.json({ ok: true, sent: true }, { headers: { "Cache-Control": "no-store" } });
        },
        { methods: ["POST"], csrf: true },
    );
}
