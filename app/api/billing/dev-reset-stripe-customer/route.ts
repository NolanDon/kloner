import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getStripe } from "@/lib/stripe";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";
import { getCustomerIdForUid, setUserTierFromStripe } from "../../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();

function isMissingStripeCustomerError(err: any): boolean {
    const code = typeof err?.code === "string" ? err.code : "";
    const param = typeof err?.param === "string" ? err.param : "";
    const message = typeof err?.message === "string" ? err.message : "";
    return (
        (code === "resource_missing" && (param === "customer" || /no such customer/i.test(message))) ||
        /similar object exists in live mode.*test mode key/i.test(message) ||
        /similar object exists in test mode.*live mode key/i.test(message)
    );
}

function isDevTestStripeKey(): boolean {
    if (process.env.NODE_ENV === "production") return false;
    const secret = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || "";
    return secret.startsWith("sk_test_");
}

async function clearLegacyStripeRefs(uid: string, customerId: string | null) {
    const db = getAdminDb();
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
    const deleteValue = admin.firestore.FieldValue.delete();

    const ops = [
        db.collection("stripe_customers").doc(uid).delete().catch(() => null),
        db.collection("users").doc(uid).set(
            {
                stripeCustomerId: deleteValue,
                updatedAt: serverTimestamp,
            },
            { merge: true },
        ),
    ];

    if (customerId) {
        ops.push(db.collection("stripe_customers").doc(customerId).delete().catch(() => null));
    }

    await Promise.all(ops);
}

async function deleteStripeCustomer(customerId: string): Promise<{ subscriptionsDeleted: number; customerDeleted: boolean }> {
    let subscriptionsDeleted = 0;
    const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
    });

    for (const sub of subs.data) {
        try {
            await stripe.subscriptions.cancel(sub.id);
            subscriptionsDeleted += 1;
        } catch (err: any) {
            if (!isMissingStripeCustomerError(err)) {
                throw err;
            }
        }
    }

    let customerDeleted = false;
    try {
        await stripe.customers.del(customerId);
        customerDeleted = true;
    } catch (err: any) {
        if (!isMissingStripeCustomerError(err)) {
            throw err;
        }
    }

    return { subscriptionsDeleted, customerDeleted };
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            if (!isDevTestStripeKey()) {
                return NextResponse.json(
                    { ok: false, error: "Dev reset is only available in local/test Stripe mode." },
                    { status: 403 },
                );
            }

            const db = getAdminDb();
            const userRef = db.collection("kloner_users").doc(uid);
            const customerId = await getCustomerIdForUid(uid);

            let subscriptionsDeleted = 0;
            let customerDeleted = false;

            if (customerId) {
                const result = await deleteStripeCustomer(customerId);
                subscriptionsDeleted = result.subscriptionsDeleted;
                customerDeleted = result.customerDeleted;
            }

            await setUserTierFromStripe(uid, "free", {
                customerId: null,
                subscriptionId: null,
                priceId: null,
                status: null,
                currentPeriodEnd: null,
                trialEnd: null,
                cancelAtPeriodEnd: null,
            });

            await userRef.set(
                {
                    tierOverrideTier: admin.firestore.FieldValue.delete(),
                    tierOverrideUntil: admin.firestore.FieldValue.delete(),
                    tierOverrideReason: admin.firestore.FieldValue.delete(),
                    tierOverrideSetAt: admin.firestore.FieldValue.delete(),
                    creditsOverrideTier: admin.firestore.FieldValue.delete(),
                    creditsOverrideUntil: admin.firestore.FieldValue.delete(),
                    creditsOverrideReason: admin.firestore.FieldValue.delete(),
                    creditsOverrideSetAt: admin.firestore.FieldValue.delete(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true },
            );

            await clearLegacyStripeRefs(uid, customerId);

            return NextResponse.json({
                ok: true,
                uid,
                customerId,
                subscriptionsDeleted,
                customerDeleted,
                billingReset: true,
            });
        },
        { methods: ["POST"] },
    );
}
