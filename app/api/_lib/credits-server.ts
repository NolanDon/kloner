// src/app/_lib/credits-server.ts
import admin from "firebase-admin";
import {
    monthlyLimitFor,
    type UserTier,
    type CreditKind as CoreCreditKind,
} from "@/src/lib/credits";

type ServerCreditKind = "preview" | "snapshot";

type PeekResult = {
    ok: boolean;
    remaining: number | null;
    monthlyLimit: number | null;
};

/**
 * Map server terminology to core credit kinds.
 *  - "preview"  => "preview"
 *  - "snapshot" => "screenshot"
 */
function toCoreKind(kind: ServerCreditKind): CoreCreditKind {
    return kind === "preview" ? "preview" : "screenshot";
}

/**
 * Compute the end of the current billing period.
 * Here: calendar month end in UTC.
 */
function currentPeriodEnd(): Date {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based
    const firstNextMonth = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    // last ms of current month
    return new Date(firstNextMonth.getTime() - 1);
}

/**
 * Read-only check of a user's monthly credits.
 * Does not decrement; only inspects Firestore and applies period expiry.
 */
export async function peekUserCredit(
    uid: string,
    tier: UserTier,
    kind: ServerCreditKind
): Promise<PeekResult> {
    const db = admin.firestore();
    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();

    const coreKind = toCoreKind(kind);
    const defaultLimit = monthlyLimitFor(tier, coreKind); // single source of truth

    if (!snap.exists) {
        // no user doc yet => treat as full allowance
        return {
            ok: defaultLimit === 0 || defaultLimit > 0,
            remaining: defaultLimit === 0 ? null : defaultLimit,
            monthlyLimit: defaultLimit === 0 ? null : defaultLimit,
        };
    }

    const data = snap.data() || {};
    const credits = (data.credits as any) || {};
    const bucket = (credits[kind] as any) || {};

    const now = new Date();

    const storedLimitRaw =
        typeof bucket.monthlyLimit === "number" && bucket.monthlyLimit >= 0
            ? bucket.monthlyLimit
            : defaultLimit;

    // If stored limit does not match the tier's limit, assume the tier changed
    // and normalize to the new tier's limit.
    const effectiveLimit = defaultLimit ?? storedLimitRaw;

    const periodEndTs = bucket.periodEnd;
    const periodEndDate: Date | null =
        periodEndTs && typeof periodEndTs.toDate === "function"
            ? (periodEndTs.toDate() as Date)
            : null;

    let remaining: number;

    const tierChanged = storedLimitRaw !== effectiveLimit;

    // New period OR tier changed OR no period info => treat as reset
    if (!periodEndDate || now >= periodEndDate || tierChanged) {
        remaining = effectiveLimit;
    } else if (typeof bucket.remaining === "number") {
        remaining = bucket.remaining;
    } else {
        remaining = effectiveLimit;
    }

    const ok = effectiveLimit === 0 || remaining > 0;

    return {
        ok,
        remaining: effectiveLimit === 0 ? null : remaining,
        monthlyLimit: effectiveLimit === 0 ? null : effectiveLimit,
    };
}

/**
 * Atomic decrement of one credit, with period reset.
 * Only call this after a successful run.
 *
 * Returns the new remaining count (or null for unlimited).
 */
export async function consumeUserCredit(
    uid: string,
    tier: UserTier,
    kind: ServerCreditKind
): Promise<PeekResult> {
    const db = admin.firestore();
    const userRef = db.collection("kloner_users").doc(uid);

    const coreKind = toCoreKind(kind);
    const limitForTier = monthlyLimitFor(tier, coreKind);

    // Unlimited tier
    if (limitForTier === 0) {
        return {
            ok: true,
            remaining: null,
            monthlyLimit: null,
        };
    }

    const now = new Date();
    const periodEnd = currentPeriodEnd();

    let finalRemaining = 0;
    let finalLimit = limitForTier;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const data = snap.exists ? snap.data() || {} : {};
        const credits = (data.credits as any) || {};
        const key = kind;

        const bucket = (credits[key] as any) || {};

        const storedLimitRaw =
            typeof bucket.monthlyLimit === "number" && bucket.monthlyLimit >= 0
                ? bucket.monthlyLimit
                : limitForTier;

        // If the stored limit does not match the new tier, normalize to tier limit.
        const effectiveLimit = limitForTier ?? storedLimitRaw;
        finalLimit = effectiveLimit;

        const periodEndTs = bucket.periodEnd;
        const periodEndDate: Date | null =
            periodEndTs && typeof periodEndTs.toDate === "function"
                ? (periodEndTs.toDate() as Date)
                : null;

        const tierChanged = storedLimitRaw !== effectiveLimit;

        let remaining: number;

        // New period OR tier changed OR no period info => reset bucket
        if (!periodEndDate || now >= periodEndDate || tierChanged) {
            remaining = effectiveLimit;
        } else if (typeof bucket.remaining === "number") {
            remaining = bucket.remaining;
        } else {
            remaining = effectiveLimit;
        }

        if (remaining <= 0) {
            finalRemaining = 0;
            tx.set(
                userRef,
                {
                    credits: {
                        ...credits,
                        [key]: {
                            remaining: 0,
                            monthlyLimit: effectiveLimit,
                            periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
                        },
                    },
                },
                { merge: true }
            );
            return;
        }

        remaining -= 1;
        finalRemaining = remaining;

        tx.set(
            userRef,
            {
                credits: {
                    ...credits,
                    [key]: {
                        remaining,
                        monthlyLimit: effectiveLimit,
                        periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
                    },
                },
            },
            { merge: true }
        );
    });

    return {
        ok: finalLimit === 0 || finalRemaining >= 0,
        remaining: finalLimit === 0 ? null : finalRemaining,
        monthlyLimit: finalLimit === 0 ? null : finalLimit,
    };
}
