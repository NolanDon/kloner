import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminAuth, getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { getCustomerIdForUid, getSubscriptionIdForUid } from "../_lib/billing";
import { getStripe } from "@/lib/stripe";
import { loadVercelIntegration } from "../_lib/vercel-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "tracksitechanges-5743f.firebasestorage.app";

function serializeValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => serializeValue(item));
    if (typeof value === "object") {
        const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
        if (typeof maybeTimestamp.toDate === "function") {
            try {
                return maybeTimestamp.toDate().toISOString();
            } catch {
                return null;
            }
        }

        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            out[key] = serializeValue(nested);
        }
        return out;
    }
    return value;
}

async function exportDocTree(docRef: FirebaseFirestore.DocumentReference, depth = 2): Promise<Record<string, unknown> | null> {
    const snap = await docRef.get();
    if (!snap.exists) return null;

    const node: Record<string, unknown> = {
        path: snap.ref.path,
        id: snap.id,
        data: serializeValue(snap.data() || {}),
    };

    if (depth <= 0) return node;

    const collections = await snap.ref.listCollections();
    if (!collections.length) return node;

    const subcollections: Record<string, unknown[]> = {};
    for (const collectionRef of collections) {
        const collectionSnap = await collectionRef.get();
        const docs: unknown[] = [];
        for (const childDoc of collectionSnap.docs) {
            const child = await exportDocTree(childDoc.ref, depth - 1);
            if (child) docs.push(child);
        }
        subcollections[collectionRef.id] = docs;
    }

    node.subcollections = subcollections;
    return node;
}

async function exportQueryDocs(queryRef: FirebaseFirestore.Query, depth = 0): Promise<Record<string, unknown>[]> {
    const snap = await queryRef.get();
    const docs: Record<string, unknown>[] = [];
    for (const doc of snap.docs) {
        const item: Record<string, unknown> = {
            path: doc.ref.path,
            id: doc.id,
            data: serializeValue(doc.data() || {}),
        };
        if (depth > 0) {
            const collections = await doc.ref.listCollections();
            const subcollections: Record<string, unknown[]> = {};
            for (const collectionRef of collections) {
                const collectionSnap = await collectionRef.get();
                subcollections[collectionRef.id] = await Promise.all(
                    collectionSnap.docs.map(async (childDoc) => {
                        const child = await exportDocTree(childDoc.ref, depth - 1);
                        return child;
                    })
                ).then((items) => items.filter(Boolean) as unknown[]);
            }
            item.subcollections = subcollections;
        }
        docs.push(item);
    }
    return docs;
}

async function exportAccount(uid: string) {
    const db = getAdminDb();
    const auth = getAdminAuth();
    const userRef = db.collection("kloner_users").doc(uid);
    const userSnap = await userRef.get();
    const authUser = await auth.getUser(uid).catch(() => null);

    const legacyCollections = {
        billingCancellationFeedback: await exportQueryDocs(db.collection("billing_cancellation_feedback").where("uid", "==", uid)),
        oauthStates: await exportQueryDocs(db.collection("oauth_states").where("uid", "==", uid)),
        legacyUsers: await exportQueryDocs(db.collection("users").where("uid", "==", uid)).catch(() => []),
        legacyStripeCustomers: await exportQueryDocs(db.collection("stripe_customers").where("uid", "==", uid)).catch(() => []),
    };

    return {
        generatedAt: new Date().toISOString(),
        uid,
        authUser: authUser
            ? {
                  uid: authUser.uid,
                  email: authUser.email || null,
                  displayName: authUser.displayName || null,
                  disabled: authUser.disabled,
                  emailVerified: authUser.emailVerified,
                  metadata: serializeValue(authUser.metadata),
              }
            : null,
        userDocument: userSnap.exists
            ? {
                  path: userSnap.ref.path,
                  id: userSnap.id,
                  data: serializeValue(userSnap.data() || {}),
                  subcollections: await exportDocTree(userRef, 2).then((doc) => doc?.subcollections || {}),
              }
            : null,
        legacyCollections,
    };
}

async function deleteMatchingQueryDocs(queryRef: FirebaseFirestore.Query): Promise<number> {
    const snap = await queryRef.get();
    if (snap.empty) return 0;

    const db = getAdminDb();
    let count = 0;

    for (const doc of snap.docs) {
        await db.recursiveDelete(doc.ref).catch(async () => {
            await doc.ref.delete().catch(() => undefined);
        });
        count += 1;
    }

    return count;
}

async function deleteStorageObjects(uid: string): Promise<number> {
    const bucket = admin.storage().bucket(BUCKET_NAME);
    const prefixes = [
        "kloner_images/",
        "kloner-images/",
        `screenshots/${uid}/`,
        `kloner-screenshots/${uid}/`,
        `kloner_ai_home/${uid}/`,
    ];

    const files = new Map<string, FirebaseFirestore.DocumentReference | null>();
    const gathered: { name: string; file: any }[] = [];

    for (const prefix of prefixes) {
        const [batch] = await bucket.getFiles({ prefix });
        for (const file of batch) {
            gathered.push({ name: file.name, file });
        }
    }

    let deleted = 0;
    for (const entry of gathered) {
        try {
            const [meta] = await entry.file.getMetadata();
            const ownerUid = meta?.metadata?.ownerUid;
            if (ownerUid && ownerUid !== uid) continue;
            await entry.file.delete();
            deleted += 1;
        } catch {
            // ignore; best effort
        }
    }

    return deleted;
}

async function revokeAndDeleteVercelIntegration(uid: string): Promise<void> {
    const db = getAdminDb();
    const integRef = db.collection("kloner_users").doc(uid).collection("integrations").doc("vercel");
    const result = await loadVercelIntegration(integRef as any);
    if (!result.exists || !result.accessToken) return;

    const data = result.data as { installationId?: string | null } | null;
    const accessToken = result.accessToken;
    const installationId = typeof data?.installationId === "string" ? data.installationId : null;

    if (accessToken) {
        try {
            if (installationId) {
                await fetch(`https://api.vercel.com/v1/integrations/installations/${installationId}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
            } else {
                await fetch("https://api.vercel.com/v2/user/tokens/current", {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
            }
        } catch {
            // best effort only
        }
    }

    await integRef.delete().catch(() => undefined);
}

async function deleteAccount(uid: string): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    const db = getAdminDb();
    const auth = getAdminAuth();
    const stripe = getStripe();

    const userRef = db.collection("kloner_users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() as any) : {};

    const subscriptionId = await getSubscriptionIdForUid(uid).catch(() => null);
    const customerId = await getCustomerIdForUid(uid).catch(() => null);

    if (subscriptionId) {
        try {
            await stripe.subscriptions.cancel(subscriptionId, { prorate: false });
        } catch (error) {
            warnings.push(`Stripe subscription cancel failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (customerId) {
        try {
            await stripe.customers.del(customerId);
        } catch (error) {
            warnings.push(`Stripe customer delete failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    try {
        await revokeAndDeleteVercelIntegration(uid);
    } catch (error) {
        warnings.push(`Vercel disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        await deleteMatchingQueryDocs(db.collection("billing_cancellation_feedback").where("uid", "==", uid));
        await deleteMatchingQueryDocs(db.collection("oauth_states").where("uid", "==", uid));
        await deleteMatchingQueryDocs(db.collection("users").where("uid", "==", uid));
        await deleteMatchingQueryDocs(db.collection("stripe_customers").where("uid", "==", uid));
        await deleteMatchingQueryDocs(db.collection("kloner_apps").where("userId", "==", uid));
    } catch (error) {
        warnings.push(`Legacy document cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        const anyDb = db as any;
        if (typeof anyDb.recursiveDelete === "function") {
            await anyDb.recursiveDelete(userRef);
        } else {
            await userRef.delete();
        }
    } catch (error) {
        warnings.push(`Firestore user delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        await deleteStorageObjects(uid);
    } catch (error) {
        warnings.push(`Storage cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        await auth.deleteUser(uid);
    } catch (error) {
        warnings.push(`Auth delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { warnings };
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const payload = await exportAccount(uid);
            return NextResponse.json(payload, {
                headers: {
                    "Cache-Control": "no-store",
                    "Content-Disposition": `attachment; filename="kloner-export-${uid}.json"`,
                },
            });
        },
        { methods: ["GET"], csrf: false },
    );
}

export async function DELETE(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const confirm = typeof body?.confirm === "string" ? body.confirm.trim() : "";

            if (confirm !== "DELETE_MY_ACCOUNT") {
                return NextResponse.json({ ok: false, error: "Confirmation required" }, { status: 400 });
            }

            const result = await deleteAccount(uid);

            return NextResponse.json(
                {
                    ok: true,
                    deleted: true,
                    warnings: result.warnings,
                },
                { headers: { "Cache-Control": "no-store" } },
            );
        },
        { methods: ["DELETE"], csrf: true },
    );
}
