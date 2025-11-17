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

    const storedLimit =
        typeof bucket.monthlyLimit === "number" && bucket.monthlyLimit >= 0
            ? bucket.monthlyLimit
            : defaultLimit;

    const periodEndTs = bucket.periodEnd;
    const periodEndDate: Date | null =
        periodEndTs && typeof periodEndTs.toDate === "function"
            ? (periodEndTs.toDate() as Date)
            : null;

    let remaining: number;

    // If there is a stored period end and it's in the past, treat as reset for peek
    if (periodEndDate && now >= periodEndDate) {
        remaining = storedLimit;
    } else if (typeof bucket.remaining === "number") {
        remaining = bucket.remaining;
    } else {
        remaining = storedLimit;
    }

    const ok = storedLimit === 0 || remaining > 0;

    return {
        ok,
        remaining: storedLimit === 0 ? null : remaining,
        monthlyLimit: storedLimit === 0 ? null : storedLimit,
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
    const limit = monthlyLimitFor(tier, coreKind);

    // Unlimited tier
    if (limit === 0) {
        return {
            ok: true,
            remaining: null,
            monthlyLimit: null,
        };
    }

    const now = new Date();
    const periodEnd = currentPeriodEnd();

    let finalRemaining = 0;
    let finalLimit = limit;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const data = snap.exists ? snap.data() || {} : {};
        const credits = (data.credits as any) || {};
        const key = kind;

        const bucket = (credits[key] as any) || {};

        const storedLimit =
            typeof bucket.monthlyLimit === "number" && bucket.monthlyLimit >= 0
                ? bucket.monthlyLimit
                : limit;

        finalLimit = storedLimit;

        const periodEndTs = bucket.periodEnd;
        const periodEndDate: Date | null =
            periodEndTs && typeof periodEndTs.toDate === "function"
                ? (periodEndTs.toDate() as Date)
                : null;

        let remaining: number;

        // New period or missing bucket → reset
        if (!periodEndDate || now >= periodEndDate) {
            remaining = storedLimit;
        } else if (typeof bucket.remaining === "number") {
            remaining = bucket.remaining;
        } else {
            remaining = storedLimit;
        }

        if (remaining <= 0) {
            finalRemaining = 0;
            // Write normalized bucket but don't go negative
            tx.set(
                userRef,
                {
                    credits: {
                        ...credits,
                        [key]: {
                            remaining: 0,
                            monthlyLimit: storedLimit,
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
                        monthlyLimit: storedLimit,
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
