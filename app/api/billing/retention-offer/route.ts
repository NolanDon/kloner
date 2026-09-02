import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getSubscriptionIdForUid } from "../../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function couponId(): string {
  const production = process.env.NODE_ENV === "production";
  return (production
    ? process.env.STRIPE_RETENTION_COUPON_PROD || process.env.STRIPE_EXIT40_COUPON_PROD || ""
    : process.env.STRIPE_RETENTION_COUPON_TEST || process.env.STRIPE_EXIT40_COUPON_TEST || "").trim();
}

export async function GET(req: NextRequest) {
  return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
    const db = admin.firestore();
    const user = await db.collection("kloner_users").doc(uid).get();
    const userData = user.exists ? (user.data() as any) : {};
    if (userData?.billingRetentionOfferUsedAt) return NextResponse.json({ ok: true, eligible: false });

    const subscriptionId = await getSubscriptionIdForUid(uid);
    const id = couponId();
    if (!subscriptionId || !id) return NextResponse.json({ ok: true, eligible: false });

    try {
      const stripe = getStripe() as unknown as Stripe;
      const coupon = await stripe.coupons.retrieve(id);
      if (coupon.percent_off !== 40 || coupon.duration !== "once") {
        return NextResponse.json({ ok: true, eligible: false });
      }
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
      const discounts = Array.isArray((subscription as any).discounts)
        ? (subscription as any).discounts
        : Array.isArray((subscription as any).discounts?.data) ? (subscription as any).discounts.data : [];
      const alreadyDiscounted = discounts.some((discount: any) => String(discount?.coupon?.id || discount?.coupon || "") === id);
      const alreadyMarked = (subscription as any).metadata?.klonerRetentionOfferUsed === "1";
      return NextResponse.json({ ok: true, eligible: !alreadyDiscounted && !alreadyMarked });
    } catch {
      return NextResponse.json({ ok: true, eligible: false });
    }
  }, { methods: ["GET"], csrf: false });
}
