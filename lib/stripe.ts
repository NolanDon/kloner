// lib/stripe.ts
import Stripe from "stripe";

const isProd = process.env.NODE_ENV === "production";

const secretKey = isProd
    ? process.env.STRIPE_SECRET_KEY_PROD
    : process.env.STRIPE_SECRET_KEY_TEST;

if (!secretKey) {
    throw new Error("Missing Stripe secret key for current environment");
}

export const stripe = new Stripe(secretKey, {
    apiVersion: "2025-10-29.clover",
});
