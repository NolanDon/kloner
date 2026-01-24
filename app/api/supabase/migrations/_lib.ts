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

export async function getSupabaseIntegration(uid: string): Promise<SupabaseIntegrationDoc | null> {
    const db = getAdminDb();
    const snap = await db
        .collection("kloner_users")
        .doc(uid)
        .collection("integrations")
        .doc("supabase")
        .get();

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
