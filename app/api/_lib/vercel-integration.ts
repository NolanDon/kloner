import type { DocumentReference } from "firebase-admin/firestore";
import { decryptString, encryptString, type EncryptedBlobV1 } from "./crypto";

export type VercelIntegrationDoc = {
    accessToken?: string | EncryptedBlobV1 | null;
    installationId?: string | null;
    vercelTeamId?: string | null;
    vercelUserId?: string | null;
    [key: string]: unknown;
};

export type LoadedVercelIntegration<T extends VercelIntegrationDoc = VercelIntegrationDoc> = {
    exists: boolean;
    data: T | null;
    accessToken: string | null;
    migrated: boolean;
};

export function isEncryptedBlobV1(value: unknown): value is EncryptedBlobV1 {
    return (
        Boolean(value) &&
        typeof value === "object" &&
        (value as EncryptedBlobV1).v === 1 &&
        (value as EncryptedBlobV1).alg === "aes-256-gcm" &&
        typeof (value as EncryptedBlobV1).iv === "string" &&
        typeof (value as EncryptedBlobV1).tag === "string" &&
        typeof (value as EncryptedBlobV1).data === "string"
    );
}

function normalizePlaintextToken(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const token = value.trim();
    return token || null;
}

async function persistEncryptedAccessToken<T extends VercelIntegrationDoc>(
    ref: DocumentReference<T>,
    accessToken: string,
): Promise<void> {
    await ref.set(
        {
            accessToken: encryptString(accessToken),
        } as any,
        { merge: true },
    );
}

export async function loadVercelIntegration<T extends VercelIntegrationDoc>(
    ref: DocumentReference<T>,
): Promise<LoadedVercelIntegration<T>> {
    const snap = await ref.get();
    if (!snap.exists) {
        return { exists: false, data: null, accessToken: null, migrated: false };
    }

    const data = snap.data() as T;
    const rawAccessToken = data?.accessToken;

    const plaintextToken = normalizePlaintextToken(rawAccessToken);
    if (plaintextToken) {
        try {
            if ((process.env.KLONER_ENCRYPTION_KEY || "").trim()) {
                await persistEncryptedAccessToken(ref, plaintextToken);
                return {
                    exists: true,
                    data,
                    accessToken: plaintextToken,
                    migrated: true,
                };
            }
        } catch (error) {
            console.warn("[vercel-integration] failed to encrypt legacy access token", {
                path: ref.path,
                error,
            });
        }

        return {
            exists: true,
            data,
            accessToken: plaintextToken,
            migrated: false,
        };
    }

    if (isEncryptedBlobV1(rawAccessToken)) {
        return {
            exists: true,
            data,
            accessToken: decryptString(rawAccessToken),
            migrated: false,
        };
    }

    return { exists: true, data, accessToken: null, migrated: false };
}