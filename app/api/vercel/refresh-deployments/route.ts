// src/app/api/vercel/refresh-deployments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, verifySession } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const user = await verifySession(req);
    const { deploymentIds } = await req.json().catch(() => ({ deploymentIds: [] as string[] }));

    if (!Array.isArray(deploymentIds) || deploymentIds.length === 0) {
        return NextResponse.json({ ok: true, updated: 0 });
    }

    const db = getAdminDb();

    const integrationRef = db.doc(`kloner_users/${user.uid}/integrations/vercel`);
    const integrationSnap = await integrationRef.get();
    if (!integrationSnap.exists) {
        return NextResponse.json(
            { ok: false, error: "Vercel is not connected for this account." },
            { status: 400 }
        );
    }

    const { accessToken, vercelTeamId } = integrationSnap.data() as {
        accessToken: string;
        vercelTeamId?: string;
    };

    const updates: { id: string; state?: string; url?: string | null }[] = [];

    for (const id of deploymentIds) {
        const params = new URLSearchParams();
        if (vercelTeamId) params.set("teamId", vercelTeamId);

        const res = await fetch(
            `https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}?${params.toString()}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!res.ok) continue;

        const json = await res.json();
        updates.push({
            id,
            state: json.state as string | undefined,
            url: json.url ? `https://${json.url}` : null,
        });
    }

    if (updates.length === 0) {
        return NextResponse.json({ ok: true, updated: 0 });
    }

    const now = new Date();
    const col = db.collection("kloner_users").doc(user.uid).collection("deployments");
    const batch = db.batch();

    for (const u of updates) {
        const ref = col.doc(u.id);
        batch.set(
            ref,
            {
                vercelState: u.state ?? null,
                vercelUrl: u.url ?? null,
                lastEventType: "manual-refresh",
                lastEventAt: now,
                updatedAt: now,
            },
            { merge: true }
        );
    }

    await batch.commit();

    return NextResponse.json({ ok: true, updated: updates.length });
}
