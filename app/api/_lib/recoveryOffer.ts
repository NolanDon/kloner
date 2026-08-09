import type Stripe from "stripe";

const RECOVERY_OFFER_MIN_INACTIVE_MS = 30 * 60 * 1000;
const WINBACK_OFFER_MIN_INACTIVE_MS = (() => {
    const raw = Number.parseInt(process.env.WINBACK_OFFER_MIN_INACTIVE_DAYS || "7", 10);
    const days = Number.isFinite(raw) && raw > 0 ? raw : 7;
    return days * 24 * 60 * 60 * 1000;
})();

function toEpochMs(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "string") {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "object") {
        const maybeAny = value as any;
        if (typeof maybeAny.toMillis === "function") {
            const ms = maybeAny.toMillis();
            return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
        }
        if (typeof maybeAny.seconds === "number") {
            const ms = maybeAny.seconds * 1000 + (typeof maybeAny.nanoseconds === "number" ? Math.floor(maybeAny.nanoseconds / 1_000_000) : 0);
            return Number.isFinite(ms) ? ms : null;
        }
        if (typeof maybeAny._seconds === "number") {
            const ms = maybeAny._seconds * 1000 + (typeof maybeAny._nanoseconds === "number" ? Math.floor(maybeAny._nanoseconds / 1_000_000) : 0);
            return Number.isFinite(ms) ? ms : null;
        }
    }
    return null;
}

export function getUserLastAppActivityMs(userData: Record<string, any> | null | undefined): number | null {
    if (!userData || typeof userData !== "object") return null;

    const candidates = [
        userData.lastAppActivityAt,
        userData.lastActivityAt,
        userData.appActivityAt,
        userData.updatedAt,
        userData.createdAt,
    ];

    for (const value of candidates) {
        const ms = toEpochMs(value);
        if (ms !== null) return ms;
    }

    return null;
}

export function getUserCreatedAtMs(userData: Record<string, any> | null | undefined): number | null {
    if (!userData || typeof userData !== "object") return null;
    return toEpochMs(userData.createdAt);
}

export function hasSentRecoveryOfferEmail(userData: Record<string, any> | null | undefined): boolean {
    if (!userData || typeof userData !== "object") return false;

    const offers = (userData as any)?.offers;
    if (offers && typeof offers === "object" && !Array.isArray(offers)) {
        if ((offers as any).exitOffer40RecoveryEmailSentAt) return true;
        if ((offers as any).exitOffer40RecoveryEmailSessionId) return true;
        if ((offers as any).winback40RecoveryEmailSentAt) return true;
    }

    if ((userData as any)["offers.exitOffer40RecoveryEmailSentAt"]) return true;
    if ((userData as any)["offers.winback40RecoveryEmailSentAt"]) return true;
    return false;
}

export function canSendRecoveryOfferEmail(
    userData: Record<string, any> | null | undefined,
    nowMs: number = Date.now(),
): { ok: boolean; reason?: "unsubscribed" | "active_recently"; lastActivityMs: number | null } {
    const prefs = (userData?.notificationPrefs || {}) as any;
    if (prefs?.journeyEmails === false) {
        return { ok: false, reason: "unsubscribed", lastActivityMs: getUserLastAppActivityMs(userData) };
    }

    const lastActivityMs = getUserLastAppActivityMs(userData);
    if (lastActivityMs !== null && nowMs - lastActivityMs < RECOVERY_OFFER_MIN_INACTIVE_MS) {
        return { ok: false, reason: "active_recently", lastActivityMs };
    }

    return { ok: true, lastActivityMs };
}

export function canSendWinbackOfferEmail(
    userData: Record<string, any> | null | undefined,
    nowMs: number = Date.now(),
): { ok: boolean; reason?: "unsubscribed" | "active_recently" | "active_subscription" | "too_new" | "already_sent"; lastActivityMs: number | null } {
    const prefs = (userData?.notificationPrefs || {}) as any;
    if (prefs?.journeyEmails === false) {
        return { ok: false, reason: "unsubscribed", lastActivityMs: getUserLastAppActivityMs(userData) };
    }

    if (hasLikelyActivePaidAccess(userData)) {
        return { ok: false, reason: "active_subscription", lastActivityMs: getUserLastAppActivityMs(userData) };
    }

    const lastActivityMs = getUserLastAppActivityMs(userData);
    const createdAtMs = getUserCreatedAtMs(userData);
    const anchorMs = lastActivityMs ?? createdAtMs;

    if (anchorMs === null) {
        return { ok: false, reason: "too_new", lastActivityMs: null };
    }

    if (nowMs - anchorMs < WINBACK_OFFER_MIN_INACTIVE_MS) {
        return { ok: false, reason: "too_new", lastActivityMs: anchorMs };
    }

    if (hasSentRecoveryOfferEmail(userData)) {
        return { ok: false, reason: "already_sent", lastActivityMs: anchorMs };
    }

    return { ok: true, lastActivityMs: anchorMs };
}

export function hasLikelyActivePaidAccess(userData: Record<string, any> | null | undefined): boolean {
    if (!userData || typeof userData !== "object") return false;

    const status = String(
        userData.stripeStatus ||
        userData.subscriptionStatus ||
        userData.billingStatus ||
        "",
    ).trim().toLowerCase();
    if (status === "active" || status === "trialing") return true;

    const tier = String(userData.tier || userData.userTier || "").trim().toLowerCase();
    return tier === "pro" || tier === "agency";
}

export async function hasActiveOrTrialingStripeSubscription(
    stripe: Stripe,
    customerId: string,
): Promise<boolean> {
    const id = String(customerId || "").trim();
    if (!id) return false;

    const subs = await stripe.subscriptions.list({
        customer: id,
        status: "all",
        limit: 100,
    });

    return subs.data.some((sub) => {
        if (sub.status === "active") return true;
        if (sub.status !== "trialing") return false;
        return sub.cancel_at_period_end !== true;
    });
}
