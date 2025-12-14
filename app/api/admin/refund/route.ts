import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_PROD!, {
    apiVersion: "2025-10-29.clover",
});

export async function POST(req: NextRequest) {
    const { invoiceId } = await req.json();

    const snap = await admin
        .firestore()
        .collection("affiliate_invoice_pi_map")
        .doc(invoiceId)
        .get();

    if (!snap.exists) {
        return NextResponse.json({ error: "No PI map" }, { status: 400 });
    }

    const { piId, chargeId } = snap.data() as any;

    const refund = piId
        ? await stripe.refunds.create({ payment_intent: piId })
        : await stripe.refunds.create({ charge: chargeId });

    return NextResponse.json({ ok: true, refund });
}
