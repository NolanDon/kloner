// app/api/billing/tier/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "../../_lib/auth";
import admin from "firebase-admin";
import { refreshTierFromStripeForUid } from "../../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const db = admin.firestore();

export async function GET(req: NextRequest) {
    try {
        const { uid } = await verifySession(req);

        // Optional query param ?refresh=1 to force Stripe hit
        const { searchParams } = new URL(req.url);
        const refresh = searchParams.get("refresh") === "1";

        let tier: "free" | "pro" | "agency";
        let userData: any = {};

        const userRef = db.collection("kloner_users").doc(uid);
        const snap = await userRef.get();
        if (snap.exists) userData = snap.data();

        if (refresh || userData.tierSource !== "stripe") {
            tier = await refreshTierFromStripeForUid(uid);
            const freshSnap = await userRef.get();
            userData = freshSnap.exists ? freshSnap.data() : {};
        } else {
            tier = (userData.tier as any) ?? "free";
        }

        return NextResponse.json(
            {
                uid,
                tier,
                stripeStatus: userData.stripeStatus ?? null,
                currentPeriodEnd: userData.stripeCurrentPeriodEnd ?? null,
                cancelAtPeriodEnd: userData.stripeCancelAtPeriodEnd ?? null,
                source: userData.tierSource ?? "stripe",
            },
            { status: 200 }
        );
    } catch (err: any) {
        console.error("billing/tier error", err);
        return NextResponse.json(
            { error: "Unauthorized or internal error" },
            { status: 401 }
        );
    }
}
