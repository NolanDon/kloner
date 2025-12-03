// lib/stripe.ts
import Stripe from "stripe";

const API_VERSION = "2025-10-29.clover" as Stripe.LatestApiVersion;

function resolveStripeSecretKey(): string | null {
    const isProd = process.env.NODE_ENV === "production";

    // const key = isProd
    //     ? process.env.STRIPE_SECRET_KEY_PROD || null
    //     : process.env.STRIPE_SECRET_KEY_TEST || null;


    // delete-me
    const key =  process.env.STRIPE_SECRET_KEY_TEST || null;

    return key;
}

let stripeSingleton: Stripe | null = null;

/**
 * Lazy Stripe client.
 * Does not crash module import if keys are missing.
 * Only throws when actually used at runtime.
 */
export function getStripe(): Stripe {
    if (stripeSingleton) return stripeSingleton;

    const secretKey = resolveStripeSecretKey();
    if (!secretKey) {
        throw new Error("Missing Stripe secret key for current environment");
    }

    stripeSingleton = new Stripe(secretKey, {
        apiVersion: API_VERSION,
    });

    return stripeSingleton;
}
