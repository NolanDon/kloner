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
 * Read-only check of a user's monthly credits.
 * Source of truth is ALWAYS the field paths:
 *   - "credits.preview"
 *   - "credits.snapshot"
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

    // Unlimited
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
            ok: true,
            remaining: defaultLimit,
            monthlyLimit: defaultLimit,
        };
    }

    // Read directly from the field path "credits.preview" / "credits.snapshot"
    const bucket = (snap.get(`credits.${kind}`) as any) || {};

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
    } else {
        remaining = bucket.remaining;
    }

    return {
        ok: remaining > 0,
        remaining,
        monthlyLimit: defaultLimit,
    };
}

/**
 * Atomic decrement of one credit, with period reset.
 * Only touches the field paths:
 *   - "credits.preview"
 *   - "credits.snapshot"
 *
 * Legacy root "credits" map is deleted and never read.
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

    let finalRemaining = 0;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);

        const bucket = (snap.get(`credits.${kind}`) as any) || {};

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
        } else {
            remaining = bucket.remaining;
        }

        if (remaining <= 0) {
            finalRemaining = 0;
            tx.set(
                userRef,
                {
                    // write only to the field path, never to "credits" map
                    [`credits.${kind}`]: {
                        remaining: 0,
                        monthlyLimit: limitForTier,
                        periodEnd: periodEndTs,
                    },
                    // hard-delete legacy root map if it exists
                    credits: admin.firestore.FieldValue.delete(),
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
                [`credits.${kind}`]: {
                    remaining,
                    monthlyLimit: limitForTier,
                    periodEnd: periodEndTs,
                },
                // hard-delete legacy root map
                credits: admin.firestore.FieldValue.delete(),
            },
            { merge: true }
        );
    });

    return {
        ok: finalRemaining >= 0,
        remaining: finalRemaining,
        monthlyLimit: limitForTier,
    };
}
