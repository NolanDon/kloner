import { getAdminDb } from "../../_lib/auth";
import { decryptString, type EncryptedBlobV1 } from "../../_lib/crypto";

export type SupabaseIntegrationDoc = {
    provider: "supabase";
    mode?: "oauth" | "manual";
    status?: string;
    projectId?: string;
    projectRef?: string;
    projectName?: string;
    supabaseUrl?: string;
    databaseUrl?: string | null;
    anonKey?: EncryptedBlobV1 | null;
    serviceRoleKey?: EncryptedBlobV1 | null;
    accessToken?: EncryptedBlobV1;
    refreshToken?: EncryptedBlobV1 | null;
    tokenExpiresAt?: Date;
};

/** Returns the Firestore DocumentReference for a per-app Supabase integration. */
export function getSupabaseIntegrationRef(uid: string, appId: string) {
    const db = getAdminDb();
    return db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_apps")
        .doc(appId)
        .collection("integrations")
        .doc("supabase");
}

/** Returns the Firestore DocumentReference for a per-app Supabase setup doc. */
export function getSupabaseSetupRef(uid: string, appId: string) {
    const db = getAdminDb();
    return db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_apps")
        .doc(appId)
        .collection("integrations")
        .doc("supabase_setup");
}

export async function getSupabaseIntegration(uid: string, appId: string): Promise<SupabaseIntegrationDoc | null> {
    const snap = await getSupabaseIntegrationRef(uid, appId).get();
    if (!snap.exists) return null;
    return snap.data() as SupabaseIntegrationDoc;
}

export function getSupabaseAccessToken(integration: SupabaseIntegrationDoc): string {
    if (!integration.accessToken) {
        throw new Error("Supabase integration missing access token");
    }
    return decryptString(integration.accessToken);
}

export function isLikelyDestructiveSql(sql: string): boolean {
    const normalized = sql
        .toLowerCase()
        .replace(/--.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, " ");

    // Heuristic: treat anything that can drop/alter/trim data or bypass RLS as destructive.
    return [
        /\bdrop\b/, 
        /\btruncate\b/, 
        /\balter\b/, 
        /\bdelete\b/, 
        /\bupdate\b/, 
        /\bgrant\b/, 
        /\brevoke\b/, 
        /\bdisable\s+row\s+level\s+security\b/, 
    ].some((re) => re.test(normalized));
}
