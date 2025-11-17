// src/app/api/vercel/refresh-deployments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VercelDeployment = {
    id: string;
    url?: string;
    state?: string;
    readyState?: string;
    name?: string;
    projectId?: string;
    target?: string; // "production" | "preview" | etc
    createdAt?: number;
    meta?: Record<string, any>;
    teamId?: string;
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req, uid }) => {
            const body = await req.json().catch(() => ({ deploymentIds: [] as string[] }));
            let deploymentIds = Array.isArray(body.deploymentIds) ? body.deploymentIds : [];

            // Clean up, dedupe, and cap
            deploymentIds = Array.from(
                new Set(
                    deploymentIds
                        .map((id: string) => (typeof id === "string" ? id.trim() : ""))
                        .filter(Boolean)
                )
            ).slice(0, 50);

            if (deploymentIds.length === 0) {
                return NextResponse.json({ ok: true, updated: 0 });
            }

            const db = getAdminDb();

            const integrationRef = db.doc(`kloner_users/${uid}/integrations/vercel`);
            const integrationSnap = await integrationRef.get();
            if (!integrationSnap.exists) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Vercel is not connected for this account.",
                    },
                    { status: 400 }
                );
            }

            const { accessToken, vercelTeamId } = integrationSnap.data() as {
                accessToken: string;
                vercelTeamId?: string;
            };

            const now = new Date();

            // Results we’ll apply back into Firestore
            const updates: Array<{
                id: string;
                state?: string;
                url?: string | null;
                readyState?: string | null;
                projectId?: string | null;
                projectName?: string | null;
                target?: string | null;
                createdAt?: Date | null;
                meta?: Record<string, any> | null;
            }> = [];

            // Fan out calls to Vercel
            const results = await Promise.allSettled(
                deploymentIds.map(async (id: string | number | boolean) => {
                    const idStr = String(id);
                    const params = new URLSearchParams();
                    if (vercelTeamId) params.set("teamId", vercelTeamId);

                    const headers: Record<string, string> = {
                        Authorization: `Bearer ${accessToken}`,
                    };

                    const res = await fetch(
                        `https://api.vercel.com/v13/deployments/${encodeURIComponent(idStr)}?${params.toString()}`,
                        {
                            method: "GET",
                            headers,
                        }
                    );

                    // Token / auth problems – mark integration as broken and abort
                    if (res.status === 401 || res.status === 403) {
                        await integrationRef.set(
                            {
                                tokenInvalid: true,
                                lastTokenErrorAt: now,
                            },
                            { merge: true }
                        );

                        throw new Error(
                            "Vercel access token is invalid or expired. Please reconnect the Vercel integration."
                        );
                    }

                    if (!res.ok) {
                        // Non-auth error: just skip this one
                        return;
                    }

                    const json = (await res.json().catch(() => null)) as VercelDeployment | null;
                    if (!json) return;

                    // Optional extra security: ensure team matches if Vercel returns one
                    if (vercelTeamId && json.teamId && json.teamId !== vercelTeamId) {
                        // Deployment doesn’t belong to this integration’s team, ignore silently
                        return;
                    }

                    const created =
                        typeof json.createdAt === "number"
                            ? new Date(json.createdAt)
                            : null;

                    updates.push({
                        id: idStr,
                        state: json.state,
                        url: json.url ? `https://${json.url}` : null,
                        readyState: json.readyState ?? null,
                        projectId: json.projectId ?? null,
                        projectName: json.name ?? null,
                        target: json.target ?? null,
                        createdAt: created,
                        meta: json.meta ?? null,
                    });
                })
            );

            // If any call threw an auth error, surface it
            const authError = results.find(
                (r) =>
                    r.status === "rejected" &&
                    /access token/i.test(String((r as any).reason?.message ?? (r as any).reason))
            );
            if (authError) {
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            "Vercel access token is invalid or expired. Please reconnect the Vercel integration from Settings.",
                    },
                    { status: 401 }
                );
            }

            if (updates.length === 0) {
                return NextResponse.json({ ok: true, updated: 0 });
            }

            const col = db.collection("kloner_users").doc(uid).collection("deployments");
            const batch = db.batch();

            for (const u of updates) {
                const ref = col.doc(u.id);

                const patch: Record<string, any> = {
                    vercelState: u.state ?? null,
                    vercelUrl: u.url ?? null,
                    vercelReadyState: u.readyState ?? null,
                    vercelTarget: u.target ?? null,
                    vercelProjectId: u.projectId ?? null,
                    vercelProjectName: u.projectName ?? null,
                    vercelMeta: u.meta ?? null,
                    lastEventType: "manual-refresh",
                    lastEventAt: now,
                    updatedAt: now,
                };

                // Only overwrite createdAt if we don’t have one yet
                if (u.createdAt) {
                    patch.createdAt = u.createdAt;
                }

                batch.set(ref, patch, { merge: true });
            }

            await batch.commit();

            return NextResponse.json({ ok: true, updated: updates.length });
        },
        { methods: ["POST"], csrf: true }
    );
}
