import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket, File } from "@google-cloud/storage";
import { getAdminAuth, getAdminDb, requireAdmin } from "../../_lib/auth";
import { getCustomerIdForUid, getSubscriptionIdForUid } from "../../_lib/billing";
import { getStripe } from "@/lib/stripe";
import { loadVercelIntegration } from "../../_lib/vercel-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "tracksitechanges-5743f.firebasestorage.app";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 20;
const SEARCH_SCAN_LIMIT = 5000;
const AUTH_USERS_CACHE_TTL_MS = 45_000;
const USERS_RESPONSE_CACHE_TTL_MS = 30_000;
const DIRECT_UID_PREFIXES = [
    "screenshots",
    "kloner-screenshots",
    "kloner_ai_home",
    "kloner_images",
];
const STORAGE_PATH_PREFIXES = [
    "screenshots/",
    "kloner-screenshots/",
    "kloner_ai_home/",
    "kloner_images/",
    "kloner-images/",
];
const SUBCOLLECTIONS_FOR_COUNTS = [
    "kloner_apps",
    "kloner_urls",
    "kloner_renders",
    "kloner_drafts",
    "deployments",
] as const;

type SortMode = "created_desc" | "last_sign_in_desc" | "last_sign_in_asc" | "storage_desc";

type UserRow = {
    uid: string;
    email: string | null;
    displayName: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
    disabled: boolean;
    emailVerified: boolean;
    tier: string | null;
    storageBytes: number;
    counts: {
        apps: number;
        urls: number;
        renders: number;
        drafts: number;
        deployments: number;
    };
};

type CachedUsersResponse = {
    expiresAt: number;
    payload: {
        ok: true;
        items: UserRow[];
        hasMore: boolean;
        page: number;
        limit: number;
        total: number | null;
    };
};

let cachedBucket: Bucket | null = null;
let cachedAuthUsers: { expiresAt: number; users: admin.auth.UserRecord[] } = {
    expiresAt: 0,
    users: [],
};
const usersResponseCache = new Map<string, CachedUsersResponse>();

function getBucket(): Bucket {
    if (cachedBucket) return cachedBucket;
    cachedBucket = admin.storage().bucket(BUCKET_NAME);
    return cachedBucket;
}

function deny() {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}

function clampLimit(raw: string | null): number {
    const parsed = Number.parseInt(String(raw || PAGE_SIZE_DEFAULT), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return PAGE_SIZE_DEFAULT;
    return Math.min(parsed, PAGE_SIZE_MAX);
}

function clampPage(raw: string | null): number {
    const parsed = Number.parseInt(String(raw || "0"), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
}

function normalizeSort(raw: string | null): SortMode {
    switch ((raw || "").trim()) {
        case "last_sign_in_desc":
        case "last_sign_in_asc":
        case "storage_desc":
            return raw as SortMode;
        default:
            return "created_desc";
    }
}

function sanitizeQuery(raw: string | null): string {
    return (raw || "").trim().toLowerCase().slice(0, 200);
}

function toIso(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    if (typeof value === "object") {
        const maybe = value as { toDate?: () => Date; seconds?: number };
        if (typeof maybe.toDate === "function") {
            try {
                return maybe.toDate().toISOString();
            } catch {
                return null;
            }
        }
        if (typeof maybe.seconds === "number") {
            return new Date(maybe.seconds * 1000).toISOString();
        }
    }
    return null;
}

function toMillis(value: unknown): number {
    const iso = toIso(value);
    if (!iso) return 0;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
}

function matchesUserQuery(user: admin.auth.UserRecord, query: string): boolean {
    if (!query) return true;
    const fields = [
        user.uid,
        user.email || "",
        user.displayName || "",
        ...(user.providerData || []).map((provider) => provider?.email || ""),
    ];
    return fields.some((field) => String(field || "").toLowerCase().includes(query));
}

async function listAllAuthUsers(limit = SEARCH_SCAN_LIMIT): Promise<admin.auth.UserRecord[]> {
    const now = Date.now();
    if (cachedAuthUsers.expiresAt > now && cachedAuthUsers.users.length) {
        return cachedAuthUsers.users.slice(0, limit);
    }

    const auth = getAdminAuth();
    const users: admin.auth.UserRecord[] = [];
    let nextPageToken: string | undefined;

    do {
        const page = await auth.listUsers(1000, nextPageToken);
        users.push(...page.users);
        nextPageToken = page.pageToken;
    } while (nextPageToken && users.length < limit);

    const sliced = users.slice(0, limit);
    cachedAuthUsers = {
        expiresAt: now + AUTH_USERS_CACHE_TTL_MS,
        users: users.slice(),
    };
    return sliced;
}

async function loadAuthUsersByUid(uids: string[]): Promise<Map<string, admin.auth.UserRecord>> {
    const auth = getAdminAuth();
    const out = new Map<string, admin.auth.UserRecord>();
    if (!uids.length) return out;

    for (let idx = 0; idx < uids.length; idx += 100) {
        const batch = uids.slice(idx, idx + 100);
        const result = await auth.getUsers(batch.map((uid) => ({ uid })));
        for (const user of result.users) {
            out.set(user.uid, user);
        }
    }

    return out;
}

async function loadUserDocsByUid(uids: string[]): Promise<Map<string, FirebaseFirestore.DocumentData | null>> {
    const db = getAdminDb();
    const out = new Map<string, FirebaseFirestore.DocumentData | null>();
    if (!uids.length) return out;

    for (let idx = 0; idx < uids.length; idx += 100) {
        const batch = uids.slice(idx, idx + 100);
        const refs = batch.map((uid) => db.collection("kloner_users").doc(uid));
        const snaps = await db.getAll(...refs);
        for (const snap of snaps) {
            out.set(snap.id, snap.exists ? snap.data() || null : null);
        }
    }

    return out;
}

async function readFileSize(file: File): Promise<number> {
    const embedded = Number((file as any)?.metadata?.size);
    if (Number.isFinite(embedded) && embedded >= 0) return embedded;

    try {
        const [meta] = await file.getMetadata();
        const parsed = Number(meta?.size || 0);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
        return 0;
    }
}

async function listFilesForPrefix(prefix: string): Promise<File[]> {
    const bucket = getBucket();
    const [files] = await bucket.getFiles({ prefix });
    return files;
}

async function loadApproxStorageUsageForUids(uids: string[], fullScan = false): Promise<Map<string, number>> {
    const target = new Set(uids);
    const usage = new Map<string, number>();
    for (const uid of uids) usage.set(uid, 0);

    if (!uids.length) return usage;

    const addUsage = (uid: string, bytes: number) => {
        if (!target.has(uid) || !Number.isFinite(bytes) || bytes <= 0) return;
        usage.set(uid, (usage.get(uid) || 0) + bytes);
    };

    if (fullScan) {
        for (const basePrefix of DIRECT_UID_PREFIXES) {
            const files = await listFilesForPrefix(`${basePrefix}/`);
            for (const file of files) {
                const segments = file.name.split("/");
                const uid = segments[1] || "";
                if (!target.has(uid)) continue;
                addUsage(uid, await readFileSize(file));
            }
        }
    } else {
        for (const uid of uids) {
            for (const basePrefix of DIRECT_UID_PREFIXES) {
                const files = await listFilesForPrefix(`${basePrefix}/${uid}/`);
                let total = 0;
                for (const file of files) {
                    total += await readFileSize(file);
                }
                addUsage(uid, total);
            }
        }
    }

    const publicFiles = await listFilesForPrefix("kloner-images/");
    for (const file of publicFiles) {
        try {
            const [meta] = await file.getMetadata();
            const ownerUid = String(meta?.metadata?.ownerUid || "").trim();
            if (!target.has(ownerUid)) continue;
            const size = Number(meta?.size || 0);
            addUsage(ownerUid, Number.isFinite(size) ? size : 0);
        } catch {
            // best-effort only
        }
    }

    return usage;
}

function collectReferencedStoragePaths(value: unknown, out: Set<string>) {
    if (!value) return;

    if (typeof value === "string") {
        const trimmed = value.trim();
        const isRelativeGcsPath =
            trimmed.length > 3 &&
            trimmed.length < 800 &&
            !trimmed.startsWith("http://") &&
            !trimmed.startsWith("https://") &&
            !trimmed.startsWith("gs://") &&
            trimmed.includes("/") &&
            !trimmed.includes(" ");

        if (STORAGE_PATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) || isRelativeGcsPath) {
            out.add(trimmed);
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) collectReferencedStoragePaths(item, out);
        return;
    }

    if (typeof value !== "object") return;

    for (const nested of Object.values(value as Record<string, unknown>)) {
        collectReferencedStoragePaths(nested, out);
    }
}

function getFileStorageCollectionName(appData: FirebaseFirestore.DocumentData | null): string {
    if (!appData || typeof appData !== "object") return "file_blobs";
    const raw = (appData as any).fileStorageCollection;
    if (typeof raw !== "string") return "file_blobs";
    const trimmed = raw.trim();
    return trimmed || "file_blobs";
}

function usesShardedAppStorage(appData: FirebaseFirestore.DocumentData | null): boolean {
    if (!appData || typeof appData !== "object") return false;
    const mode = typeof (appData as any).fileStorageMode === "string" ? (appData as any).fileStorageMode : "";
    return mode === "sharded" || Boolean((appData as any).fileManifest) || Boolean((appData as any).fileStorageCollection);
}

async function collectAppShardStoragePaths(
    appRef: FirebaseFirestore.DocumentReference,
    appData: FirebaseFirestore.DocumentData | null,
    referencedPaths: Set<string>,
): Promise<void> {
    if (!usesShardedAppStorage(appData)) return;

    try {
        const collectionName = getFileStorageCollectionName(appData);
        const shardSnap = await appRef.collection(collectionName).get();
        for (const shardDoc of shardSnap.docs) {
            collectReferencedStoragePaths(shardDoc.data(), referencedPaths);
        }
    } catch {
        // best-effort only
    }
}

function isCoveredByApproxStorage(path: string): boolean {
    return DIRECT_UID_PREFIXES.some((prefix) => path.startsWith(`${prefix}/`)) || path.startsWith("kloner-images/");
}

async function loadUserPageDetails(
    rows: Array<{ uid: string }>,
    userDocs: Map<string, FirebaseFirestore.DocumentData | null>,
    approxStorage: Map<string, number>,
): Promise<Map<string, { storageBytes: number; counts: UserRow["counts"] }>> {
    const db = getAdminDb();
    const details = new Map<string, { storageBytes: number; counts: UserRow["counts"] }>();

    await Promise.all(
        rows.map(async ({ uid }) => {
            const userRef = db.collection("kloner_users").doc(uid);
            const counts: UserRow["counts"] = {
                apps: 0,
                urls: 0,
                renders: 0,
                drafts: 0,
                deployments: 0,
            };
            const referencedPaths = new Set<string>();

            collectReferencedStoragePaths(userDocs.get(uid), referencedPaths);

            for (const name of SUBCOLLECTIONS_FOR_COUNTS) {
                try {
                    const snap = await userRef.collection(name).get();
                    const size = snap.size;
                    if (name === "kloner_apps") counts.apps = size;
                    if (name === "kloner_urls") counts.urls = size;
                    if (name === "kloner_renders") counts.renders = size;
                    if (name === "kloner_drafts") counts.drafts = size;
                    if (name === "deployments") counts.deployments = size;
                    for (const docSnap of snap.docs) {
                        const docData = docSnap.data();
                        collectReferencedStoragePaths(docData, referencedPaths);

                        if (name === "kloner_apps") {
                            await collectAppShardStoragePaths(docSnap.ref, docData, referencedPaths);
                        }
                    }
                } catch {
                    // best-effort only
                }
            }

            let exactReferencedBytes = 0;
            for (const path of referencedPaths) {
                if (isCoveredByApproxStorage(path)) continue;
                try {
                    const [meta] = await getBucket().file(path).getMetadata();
                    const size = Number(meta?.size || 0);
                    exactReferencedBytes += Number.isFinite(size) ? size : 0;
                } catch {
                    // ignore missing assets
                }
            }

            details.set(uid, {
                storageBytes: (approxStorage.get(uid) || 0) + exactReferencedBytes,
                counts,
            });
        }),
    );

    return details;
}

function buildUserRow(
    uid: string,
    authUser: admin.auth.UserRecord | null,
    userDoc: FirebaseFirestore.DocumentData | null,
): UserRow {
    const createdAt =
        toIso(userDoc?.createdAt) ||
        toIso(authUser?.metadata?.creationTime || null) ||
        null;
    const lastSignInAt = toIso(authUser?.metadata?.lastSignInTime || null);

    return {
        uid,
        email: authUser?.email || userDoc?.email || userDoc?.stripeCustomerEmail || null,
        displayName: authUser?.displayName || userDoc?.displayName || null,
        createdAt,
        lastSignInAt,
        disabled: Boolean(authUser?.disabled),
        emailVerified: Boolean(authUser?.emailVerified),
        tier: typeof userDoc?.tier === "string" ? userDoc.tier : typeof userDoc?.userTier === "string" ? userDoc.userTier : null,
        storageBytes: 0,
        counts: {
            apps: 0,
            urls: 0,
            renders: 0,
            drafts: 0,
            deployments: 0,
        },
    };
}

function sortRows(rows: UserRow[], sort: SortMode): UserRow[] {
    const next = rows.slice();
    next.sort((a, b) => {
        if (sort === "last_sign_in_desc") {
            return toMillis(b.lastSignInAt) - toMillis(a.lastSignInAt);
        }
        if (sort === "last_sign_in_asc") {
            return toMillis(a.lastSignInAt) - toMillis(b.lastSignInAt);
        }
        if (sort === "storage_desc") {
            return b.storageBytes - a.storageBytes;
        }
        return toMillis(b.createdAt) - toMillis(a.createdAt);
    });
    return next;
}

async function deleteMatchingQueryDocs(queryRef: FirebaseFirestore.Query): Promise<number> {
    const snap = await queryRef.get();
    if (snap.empty) return 0;

    const db = getAdminDb();
    let count = 0;

    for (const doc of snap.docs) {
        await (db as any).recursiveDelete(doc.ref).catch(async () => {
            await doc.ref.delete().catch(() => undefined);
        });
        count += 1;
    }

    return count;
}

async function deleteStorageObjects(uid: string): Promise<number> {
    const bucket = getBucket();
    const prefixes = [
        "kloner-images/",
        `screenshots/${uid}/`,
        `kloner-screenshots/${uid}/`,
        `kloner_ai_home/${uid}/`,
        `kloner_images/${uid}/`,
    ];

    const gathered: Array<{ name: string; file: File }> = [];

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

async function collectUserReferencedStoragePaths(uid: string): Promise<Set<string>> {
    const db = getAdminDb();
    const userRef = db.collection("kloner_users").doc(uid);
    const referencedPaths = new Set<string>();

    try {
        const userSnap = await userRef.get();
        if (userSnap.exists) {
            collectReferencedStoragePaths(userSnap.data() || null, referencedPaths);
        }
    } catch {
        // best-effort only
    }

    for (const name of SUBCOLLECTIONS_FOR_COUNTS) {
        try {
            const snap = await userRef.collection(name).get();
            for (const docSnap of snap.docs) {
                const docData = docSnap.data();
                collectReferencedStoragePaths(docData, referencedPaths);

                if (name === "kloner_apps") {
                    await collectAppShardStoragePaths(docSnap.ref, docData, referencedPaths);
                }
            }
        } catch {
            // best-effort only
        }
    }

    return referencedPaths;
}

async function deleteReferencedStorageObjects(uid: string, paths: Set<string>): Promise<number> {
    if (!paths.size) return 0;

    const bucket = getBucket();
    let deleted = 0;

    for (const rawPath of paths) {
        const path = typeof rawPath === "string" ? rawPath.trim() : "";
        if (!path || path.startsWith("http://") || path.startsWith("https://") || path.startsWith("gs://")) {
            continue;
        }

        try {
            const file = bucket.file(path);
            const [meta] = await file.getMetadata();
            const ownerUid = typeof meta?.metadata?.ownerUid === "string" ? meta.metadata.ownerUid : "";
            if (ownerUid && ownerUid !== uid) continue;
            await file.delete();
            deleted += 1;
        } catch {
            // ignore missing assets
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
        const referencedPaths = await collectUserReferencedStoragePaths(uid);
        await Promise.all([
            deleteStorageObjects(uid),
            deleteReferencedStorageObjects(uid, referencedPaths),
        ]);
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
    const gate = await requireAdmin(req);
    if (!gate.ok) return deny();

    try {
        const db = getAdminDb();
        const { searchParams } = new URL(req.url);
        const query = sanitizeQuery(searchParams.get("q"));
        const page = clampPage(searchParams.get("page"));
        const limit = clampLimit(searchParams.get("limit"));
        const sort = normalizeSort(searchParams.get("sort"));
        const cacheKey = `${query}|${sort}|${page}|${limit}`;

        const cached = usersResponseCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.payload, {
                headers: { "Cache-Control": "private, max-age=15" },
            });
        }

        let rows: UserRow[] = [];
        let hasMore = false;
        let total: number | null = null;

        if (!query && sort === "created_desc") {
            const snap = await db
                .collection("kloner_users")
                .orderBy("createdAt", "desc")
                .offset(page * limit)
                .limit(limit + 1)
                .get();

            const docs = snap.docs;
            hasMore = docs.length > limit;
            const pageDocs = hasMore ? docs.slice(0, limit) : docs;
            const uids = pageDocs.map((doc) => doc.id);
            const authMap = await loadAuthUsersByUid(uids);
            const userDocs = new Map<string, FirebaseFirestore.DocumentData | null>();

            for (const doc of pageDocs) {
                userDocs.set(doc.id, doc.data() || null);
            }

            rows = pageDocs.map((doc) => buildUserRow(doc.id, authMap.get(doc.id) || null, userDocs.get(doc.id) || null));
            const approxStorage = await loadApproxStorageUsageForUids(uids, false);
            const details = await loadUserPageDetails(rows, userDocs, approxStorage);

            rows = rows.map((row) => {
                const detail = details.get(row.uid);
                return detail
                    ? { ...row, storageBytes: detail.storageBytes, counts: detail.counts }
                    : row;
            });
        } else {
            const authUsers = await listAllAuthUsers();
            const matchedAuthUsers = authUsers.filter((user) => matchesUserQuery(user, query));
            total = matchedAuthUsers.length;

            const userDocs = await loadUserDocsByUid(matchedAuthUsers.map((user) => user.uid));
            rows = matchedAuthUsers.map((user) => buildUserRow(user.uid, user, userDocs.get(user.uid) || null));

            if (sort === "storage_desc") {
                const approxStorage = await loadApproxStorageUsageForUids(rows.map((row) => row.uid), true);
                rows = rows.map((row) => ({ ...row, storageBytes: approxStorage.get(row.uid) || 0 }));
            }

            rows = sortRows(rows, sort);
            const sliceStart = page * limit;
            const pageRows = rows.slice(sliceStart, sliceStart + limit);
            hasMore = sliceStart + limit < rows.length;

            const approxStorage =
                sort === "storage_desc"
                    ? new Map(pageRows.map((row) => [row.uid, row.storageBytes]))
                    : await loadApproxStorageUsageForUids(pageRows.map((row) => row.uid), false);
            const details = await loadUserPageDetails(pageRows, userDocs, approxStorage);

            rows = pageRows.map((row) => {
                const detail = details.get(row.uid);
                return detail
                    ? { ...row, storageBytes: detail.storageBytes, counts: detail.counts }
                    : row;
            });

            if (sort === "storage_desc") {
                rows = sortRows(rows, sort);
            }
        }

        const payload = {
            ok: true as const,
            items: rows,
            hasMore,
            page,
            limit,
            total,
        };

        usersResponseCache.set(cacheKey, {
            expiresAt: Date.now() + USERS_RESPONSE_CACHE_TTL_MS,
            payload,
        });

        if (usersResponseCache.size > 120) {
            const oldestKey = usersResponseCache.keys().next().value;
            if (typeof oldestKey === "string") {
                usersResponseCache.delete(oldestKey);
            }
        }

        return NextResponse.json(payload, {
            headers: { "Cache-Control": "private, max-age=15" },
        });
    } catch (error) {
        console.error("[api/admin/users] GET failed", error);
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : "Failed to load users",
            },
            { status: 500 },
        );
    }
}

export async function DELETE(req: NextRequest) {
    const gate = await requireAdmin(req);
    if (!gate.ok) return deny();

    try {
        const body = await req.json().catch(() => ({} as any));
        const uid = typeof body?.uid === "string" ? body.uid.trim() : "";
        if (!uid) {
            return NextResponse.json({ ok: false, error: "Missing uid" }, { status: 400 });
        }

        const result = await deleteAccount(uid);
        usersResponseCache.clear();
        cachedAuthUsers = { expiresAt: 0, users: [] };
        return NextResponse.json(
            {
                ok: true,
                deleted: true,
                uid,
                warnings: result.warnings,
            },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (error) {
        console.error("[api/admin/users] DELETE failed", error);
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : "Failed to delete user",
            },
            { status: 500 },
        );
    }
}