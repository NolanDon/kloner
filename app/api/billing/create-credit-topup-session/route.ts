import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { assertCsrf, getAdminAuth, getAdminDb, verifySession } from "@/app/api/_lib/auth";
import { linkCustomerToUid } from "@/app/api/_lib/billing";
import { captureCriticalEvent, captureException } from "@/lib/observability";
import { getTopupCatalogConfig, resolveTopupPreset } from "@/src/lib/topupCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();

function normalizeCredits(input: unknown): number | null {
    const n = typeof input === "number" ? input : typeof input === "string" ? Number(input) : NaN;
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
}

function normalizeNextPath(input: unknown): string | null {
    const raw = typeof input === "string" ? input.trim() : "";
    if (!raw) return null;
    if (raw.length > 2048) return null;

    // Only allow same-origin relative paths to avoid open redirects.
    if (!raw.startsWith("/")) return null;
    if (raw.startsWith("//")) return null; // protocol-relative
    if (raw.includes("://")) return null;

    return raw;
}

function isMissingStripeCustomerError(err: any): boolean {
    const code = typeof err?.code === "string" ? err.code : "";
    const param = typeof err?.param === "string" ? err.param : "";
    const message = typeof err?.message === "string" ? err.message : "";
    return code === "resource_missing" && (param === "customer" || /no such customer/i.test(message));
}

function mapPublicErrorMessage(err: any, status: number): string {
    const message = typeof err?.message === "string" ? err.message : "";
    if (isMissingStripeCustomerError(err)) {
        return "Billing profile mismatch detected. Please retry checkout.";
    }
    if (status === 401) return "Unauthorized";
    if (status === 403) return "Forbidden";
    if (status >= 500) return "Unable to start checkout right now. Please try again.";
    return message || "Unable to start checkout. Please try again.";
}

function readBearerToken(req: NextRequest): string | null {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice(7).trim();
    return token || null;
}

async function handler(req: NextRequest, uid: string) {
    const db = getAdminDb();

    const body = await req.json().catch(() => ({} as any));

    const { currency, unitPriceCents, minCredits, maxCredits, stepCredits } = getTopupCatalogConfig();

    const presetId = typeof body?.presetId === "string" ? body.presetId : null;
    const preset = resolveTopupPreset(presetId);
    const creditsRaw = preset ? preset.credits : normalizeCredits(body?.credits);

    if (!creditsRaw) {
        return NextResponse.json({ error: "Missing or invalid credits" }, { status: 400 });
    }

    if (presetId && !preset) {
        return NextResponse.json({ error: "Unknown top-up package" }, { status: 400 });
    }

    if (preset && !preset.available) {
        return NextResponse.json(
            { error: `Stripe price is not configured for package "${preset.label}".` },
            { status: 500 },
        );
    }

    if (!preset) {
        if (creditsRaw < minCredits || creditsRaw > maxCredits) {
            return NextResponse.json(
                { error: `Credits must be between ${minCredits} and ${maxCredits}.` },
                { status: 400 },
            );
        }

        if (stepCredits > 1 && creditsRaw % stepCredits !== 0) {
            return NextResponse.json(
                { error: `Credits must be in increments of ${stepCredits}.` },
                { status: 400 },
            );
        }
    }

    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const userData = snap.exists ? (snap.data() as any) : {};

    let customerId: string | undefined =
        typeof userData?.stripeCustomerId === "string" && userData.stripeCustomerId.trim()
            ? userData.stripeCustomerId.trim()
            : undefined;

    const createAndPersistCustomer = async (): Promise<string> => {
        const authUser = await getAdminAuth().getUser(uid);
        const email = authUser.email ?? undefined;

        const customer = await stripe.customers.create({
            email,
            metadata: { firebaseUid: uid },
        });

        const nextCustomerId = customer.id;
        await userRef.set({ stripeCustomerId: nextCustomerId }, { merge: true });
        await linkCustomerToUid(nextCustomerId, uid);
        return nextCustomerId;
    };

    if (!customerId) {
        customerId = await createAndPersistCustomer();
    }

    const origin = new URL(req.url).origin;
    const nextPath = normalizeNextPath(body?.next) || "/topup";

    const successUrlObj = new URL(nextPath, origin);
    successUrlObj.searchParams.set("topup", "success");
    successUrlObj.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

    const cancelUrlObj = new URL(nextPath, origin);
    cancelUrlObj.searchParams.set("topup", "cancel");

    const successUrl = successUrlObj
        .toString()
        // Stripe only substitutes the literal token, so avoid percent-encoding braces.
        .replace(/%7BCHECKOUT_SESSION_ID%7D/gi, "{CHECKOUT_SESSION_ID}");
    const cancelUrl = cancelUrlObj.toString();

    const makeSession = async (resolvedCustomerId: string) =>
        stripe.checkout.sessions.create({
            mode: "payment",
            customer: resolvedCustomerId,
            allow_promotion_codes: true,
            success_url: successUrl,
            cancel_url: cancelUrl,
            payment_method_options: {
                card: {
                    request_three_d_secure: "any",
                },
            },
            line_items: preset
                ? [
                      {
                          price: preset.priceId as string,
                          quantity: 1,
                      },
                  ]
                : [
                      {
                          price_data: {
                              currency,
                              unit_amount: unitPriceCents,
                              product_data: {
                                  name: `AI credit top-up (${creditsRaw} credits)`,
                                  description:
                                      "Adds AI edit credits to your account (does not change your monthly plan limits).",
                              },
                          },
                          quantity: creditsRaw,
                      },
                  ],
            metadata: {
                type: "ai_credit_topup",
                firebaseUid: uid,
                aiEditCredits: String(creditsRaw),
                unitPriceCents: String(unitPriceCents),
                currency,
                ...(preset
                    ? {
                          topupPresetId: preset.id,
                          topupPresetPriceId: preset.priceId as string,
                      }
                    : {}),
            },
        });

    let session;
    try {
        session = await makeSession(customerId);
    } catch (err: any) {
        if (customerId && isMissingStripeCustomerError(err)) {
            const repairedCustomerId = await createAndPersistCustomer();
            session = await makeSession(repairedCustomerId);
        } else {
            throw err;
        }
    }

    return NextResponse.json({ url: session.url });
}

export async function POST(req: NextRequest) {
    try {
        let decoded: any;

        try {
            assertCsrf(req);
            decoded = await verifySession(req);
        } catch (sessionErr) {
            const bearer = readBearerToken(req);
            if (!bearer) {
                throw sessionErr;
            }
            decoded = await getAdminAuth().verifyIdToken(bearer, true);
        }

        const uid = decoded.uid;
        const response = await handler(req, uid);
        if (response.status >= 400) {
            await captureCriticalEvent({
                source: "vercel",
                severity: response.status >= 500 ? "critical" : "error",
                statusCode: response.status,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "billing.createCreditTopupSession",
                userId: uid,
                message: `Top-up session request failed with status ${response.status}`,
                service: "billing",
                url: req.url,
            });
        }
        return response;
    } catch (err: any) {
        const status =
            typeof err?.status === "number"
                ? err.status
                : typeof err?.statusCode === "number"
                  ? err.statusCode
                  : 500;
        const msg = mapPublicErrorMessage(err, status);
        if (status >= 500) {
            await captureException({
                source: "vercel",
                error: err,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "billing.createCreditTopupSession",
                statusCode: status,
                service: "billing",
                url: req.url,
            });
        } else {
            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: status,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "billing.createCreditTopupSession",
                message: msg,
                service: "billing",
                url: req.url,
            });
        }
        return NextResponse.json({ error: msg }, { status });
    }
}
