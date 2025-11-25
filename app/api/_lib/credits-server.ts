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
 * Map server terminology to core credit kinds:
 *  - "preview"  => "preview"
 *  - "snapshot" => "screenshot"
 */
function toCoreKind(kind: ServerCreditKind): CoreCreditKind {
    return kind === "preview" ? "preview" : "screenshot";
}

/**
 * Cost per operation in credits.
 *  - preview:  15 credits
 *  - snapshot: 10 credits
 */
function creditCost(kind: ServerCreditKind): number {
    return kind === "preview" ? 15 : 10;
}

/**
 * End of current calendar month (UTC).
 */
function currentPeriodEnd(): Date {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based
    const firstNextMonth = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    return new Date(firstNextMonth.getTime() - 1);
}

/**
 * Dumb-simple helper to read the correct bucket.
 * Works whether the doc is:
 *   { "credits.preview": {...}, "credits.snapshot": {...} }
 * or:
 *   { credits: { preview: {...}, snapshot: {...} } }
 */
function getCreditsBucket(
    snap: admin.firestore.DocumentSnapshot,
    kind: ServerCreditKind
): any {
    if (!snap.exists) return {};

    const data = (snap.data() as any) || {};
    let bucket: any;

    if (kind === "preview") {
        bucket =
            data["credits.preview"] ||
            (data.credits && data.credits.preview) ||
            {};
    } else {
        bucket =
            data["credits.snapshot"] ||
            (data.credits && data.credits.snapshot) ||
            {};
    }

    return bucket || {};
}

/**
 * Dumb-simple helper to get the field name we write back to.
 */
function getCreditsFieldName(kind: ServerCreditKind): string {
    return kind === "preview" ? "credits.preview" : "credits.snapshot";
}

/**
 * Read-only check of a user's monthly credits.
 * Source of truth is ALWAYS the nested map:
 *
 *   credits.preview
 *   credits.snapshot
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
    const defaultLimit = monthlyLimitFor(tier, coreKind);
    const cost = creditCost(kind);

    // Unlimited tier
    if (defaultLimit === 0) {
        return {
            ok: true,
            remaining: null,
            monthlyLimit: null,
        };
    }

    // No doc => full allowance
    if (!snap.exists) {
        return {
            ok: defaultLimit >= cost,
            remaining: defaultLimit,
            monthlyLimit: defaultLimit,
        };
    }

    const bucket = getCreditsBucket(snap, kind);

    console.log("[credits] peekUserCredit bucket", {
        uid,
        kind,
        bucket,
    });

    const now = new Date();
    const periodEndTs = bucket.periodEnd;
    const periodEndDate: Date | null =
        periodEndTs && typeof periodEndTs.toDate === "function"
            ? (periodEndTs.toDate() as Date)
            : null;

    let remaining: number;

    // If expired, missing, or invalid -> full reset (logically)
    if (
        !periodEndDate ||
        now >= periodEndDate ||
        typeof bucket.remaining !== "number" ||
        bucket.remaining < 0
    ) {
        remaining = defaultLimit;
        console.log("[credits] peekUserCredit reset logical bucket", {
            uid,
            kind,
            periodEndDate,
            bucketRemaining: bucket.remaining,
            remaining,
        });
    } else {
        remaining = bucket.remaining;
        console.log("[credits] peekUserCredit use existing", {
            uid,
            kind,
            periodEndDate,
            remaining,
        });
    }

    return {
        ok: remaining >= cost,
        remaining,
        monthlyLimit: defaultLimit,
    };
}

/**
 * Atomic decrement of credits for one operation, with period reset.
 * Only touches:
 *
 *   credits.preview
 *   credits.snapshot
 *
 * It will only consume credits if the user has at least the full cost:
 *   - preview:  15
 *   - snapshot: 10
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
    const cost = creditCost(kind);

    // Unlimited tier: no writes, always ok
    if (limitForTier === 0) {
        return {
            ok: true,
            remaining: null,
            monthlyLimit: null,
        };
    }

    const now = new Date();
    const periodEnd = currentPeriodEnd();
    const periodEndTs = admin.firestore.Timestamp.fromDate(periodEnd);

    const fieldName = getCreditsFieldName(kind);

    let finalRemaining = 0;
    let success = false;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const bucket = getCreditsBucket(snap, kind);

        console.log("[credits] consumeUserCredit txn bucket", {
            uid,
            kind,
            bucket,
        });

        const bucketPeriodEndTs = bucket.periodEnd;
        const bucketPeriodEndDate: Date | null =
            bucketPeriodEndTs && typeof bucketPeriodEndTs.toDate === "function"
                ? (bucketPeriodEndTs.toDate() as Date)
                : null;

        let remaining: number;

        // If no period, expired, or invalid remaining -> reset to full limit
        if (
            !bucketPeriodEndDate ||
            now >= bucketPeriodEndDate ||
            typeof bucket.remaining !== "number" ||
            bucket.remaining < 0
        ) {
            remaining = limitForTier;
            console.log("[credits] consumeUserCredit reset in txn", {
                uid,
                kind,
                bucketPeriodEndDate,
                bucketRemaining: bucket.remaining,
                resetTo: remaining,
            });
        } else {
            remaining = bucket.remaining;
            console.log("[credits] consumeUserCredit existing in txn", {
                uid,
                kind,
                bucketPeriodEndDate,
                remaining,
            });
        }

        // Not enough to cover full cost -> do NOT consume
        if (remaining < cost) {
            finalRemaining = remaining;
            success = false;

            console.log("[credits] consumeUserCredit insufficient", {
                uid,
                kind,
                remaining,
                cost,
            });

            // Just persist a sane bucket; do NOT touch monthlyLimit other than keeping it at tier limit
            tx.set(
                userRef,
                {
                    [fieldName]: {
                        remaining,
                        monthlyLimit: limitForTier,
                        periodEnd: periodEndTs,
                    },
                },
                { merge: true }
            );
            return;
        }

        // Enough balance: consume full cost
        remaining -= cost;
        finalRemaining = remaining;
        success = true;

        console.log("[credits] consumeUserCredit debiting", {
            uid,
            kind,
            cost,
            remaining,
        });

        tx.set(
            userRef,
            {
                [fieldName]: {
                    remaining,
                    monthlyLimit: limitForTier,
                    periodEnd: periodEndTs,
                },
            },
            { merge: true }
        );
    });

    return {
        ok: success,
        remaining: finalRemaining,
        monthlyLimit: limitForTier,
    };
}
