// app/api/supabase/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";
import { decryptString, encryptString, EncryptedBlobV1 } from "../../_lib/crypto";

export const runtime = "nodejs";

function toValidDateOrNull(v: unknown): Date | null {
    try {
        if (!v) return null;
        if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
        if (typeof v === "number") {
            const d = new Date(v);
            return Number.isFinite(d.getTime()) ? d : null;
        }
        if (typeof v === "string") {
            const d = new Date(v);
            return Number.isFinite(d.getTime()) ? d : null;
        }
        const anyV: any = v as any;
        if (typeof anyV?.toDate === "function") {
            const d = anyV.toDate();
            return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
        }
        return null;
    } catch {
        return null;
    }
}

function normalizeString(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

async function refreshSupabaseAccessToken(params: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date } | null> {
    const { clientId, clientSecret, refreshToken } = params;
    const res = await fetch("https://api.supabase.com/v1/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return null;

    const data: any = await res.json().catch(() => null);
    const access = normalizeString(data?.access_token);
    const refresh = normalizeString(data?.refresh_token);
    const expiresIn = typeof data?.expires_in === "number" ? data.expires_in : 0;
    if (!access || !expiresIn) return null;

    return {
        accessToken: access,
        refreshToken: refresh || null,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const cleanupIfDeleted = Boolean(body?.cleanupIfDeleted);

            const db = getAdminDb();
            const integrationRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("supabase");

            const setupRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("supabase_setup");

            const snap = await integrationRef.get();
            if (!snap.exists) {
                return NextResponse.json({ ok: true, connected: false, reason: "no_integration" });
            }

            const data: any = snap.data() as any;
            const mode = normalizeString(data?.mode) || (data?.accessToken ? "oauth" : "manual");
            const projectRef = normalizeString(data?.projectRef) || normalizeString(data?.projectId);

            // OAuth mode: verify via Supabase management API (more authoritative).
            const encryptedAccessToken = data?.accessToken as EncryptedBlobV1 | undefined;
            const encryptedRefreshToken = data?.refreshToken as EncryptedBlobV1 | null | undefined;
            const tokenExpiresAt = toValidDateOrNull(data?.tokenExpiresAt);

            if (encryptedAccessToken && projectRef) {
                let accessToken = "";
                try {
                    accessToken = decryptString(encryptedAccessToken);
                } catch {
                    accessToken = "";
                }

                // Refresh token if it's expired/near-expired.
                const expiresSoon = tokenExpiresAt ? tokenExpiresAt.getTime() - Date.now() < 60_000 : false;
                if ((!accessToken || expiresSoon) && encryptedRefreshToken) {
                    const clientId = normalizeString(process.env.SUPABASE_CLIENT_ID);
                    const clientSecret = normalizeString(process.env.SUPABASE_CLIENT_SECRET);
                    if (clientId && clientSecret) {
                        let refreshToken = "";
                        try {
                            refreshToken = decryptString(encryptedRefreshToken);
                        } catch {
                            refreshToken = "";
                        }

                        if (refreshToken) {
                            const refreshed = await refreshSupabaseAccessToken({
                                clientId,
                                clientSecret,
                                refreshToken,
                            });
                            if (refreshed) {
                                accessToken = refreshed.accessToken;
                                await integrationRef.set(
                                    {
                                        accessToken: encryptString(refreshed.accessToken),
                                        refreshToken: refreshed.refreshToken ? encryptString(refreshed.refreshToken) : encryptedRefreshToken,
                                        tokenExpiresAt: refreshed.expiresAt,
                                        updatedAt: new Date(),
                                    },
                                    { merge: true },
                                );
                            }
                        }
                    }
                }

                if (!accessToken) {
                    return NextResponse.json({ ok: true, connected: false, reason: "missing_access_token" });
                }

                const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}`;
                const res = await fetch(url, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    signal: AbortSignal.timeout(20_000),
                }).catch((e: any) => ({ ok: false, status: 0, _error: e } as any));

                const status = typeof (res as any)?.status === "number" ? (res as any).status : 0;

                if ((res as any)?.ok) {
                    return NextResponse.json({ ok: true, connected: true, reason: "verified" });
                }

                // If the management API says 404, the project is gone.
                if (status === 404) {
                    if (cleanupIfDeleted) {
                        await Promise.all([
                            integrationRef.delete().catch(() => undefined),
                            setupRef.delete().catch(() => undefined),
                        ]);
                    }
                    return NextResponse.json({
                        ok: true,
                        connected: false,
                        reason: "project_deleted",
                        cleanedUp: cleanupIfDeleted,
                    });
                }

                // If unauthorized, token may be stale; don't auto-delete.
                if (status === 401 || status === 403) {
                    return NextResponse.json({ ok: true, connected: false, reason: "unauthorized" });
                }

                // Other errors: treat as temporarily unverifiable.
                return NextResponse.json({ ok: true, connected: true, reason: "verify_failed_treat_as_connected", httpStatus: status || null });
            }

            // Manual mode: verify by reaching the project URL.
            const supabaseUrl = normalizeString(data?.supabaseUrl);
            const encryptedAnonKey = data?.anonKey as EncryptedBlobV1 | undefined;
            if (supabaseUrl && encryptedAnonKey) {
                let anonKey = "";
                try {
                    anonKey = decryptString(encryptedAnonKey);
                } catch {
                    anonKey = "";
                }

                const healthUrl = supabaseUrl.replace(/\/$/, "") + "/auth/v1/health";
                const r = await fetch(healthUrl, {
                    headers: anonKey
                        ? {
                              apikey: anonKey,
                              Authorization: `Bearer ${anonKey}`,
                          }
                        : undefined,
                    signal: AbortSignal.timeout(15_000),
                }).catch(() => null);

                if (r && r.ok) {
                    return NextResponse.json({ ok: true, connected: true, reason: "verified" });
                }

                const s = r ? r.status : 0;
                if (!r || s === 404) {
                    // Likely deleted / DNS gone.
                    if (cleanupIfDeleted) {
                        await Promise.all([
                            integrationRef.delete().catch(() => undefined),
                            setupRef.delete().catch(() => undefined),
                        ]);
                    }
                    return NextResponse.json({ ok: true, connected: false, reason: "project_deleted", cleanedUp: cleanupIfDeleted });
                }

                if (s === 401 || s === 403) {
                    return NextResponse.json({ ok: true, connected: false, reason: "unauthorized" });
                }

                return NextResponse.json({ ok: true, connected: true, reason: "verify_failed_treat_as_connected", httpStatus: s || null });
            }

            // Unknown shape; don't claim connected.
            return NextResponse.json({ ok: true, connected: false, reason: "missing_verification_material" });
        },
        { csrf: true, methods: ["POST"] },
    );
}
