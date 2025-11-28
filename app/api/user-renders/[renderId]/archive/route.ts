// app/api/user-renders/[renderId]/archive/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArchivePayload = {
    archived: boolean;
};

export async function POST(
    req: NextRequest,
    { params }: { params: { renderId: string } },
) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const renderId = params.renderId;

        if (!renderId || typeof renderId !== "string") {
            return NextResponse.json(
                { ok: false, error: "Missing renderId in route params" },
                { status: 400 },
            );
        }

        let body: ArchivePayload;
        try {
            body = (await authedReq.json()) as ArchivePayload;
        } catch {
            return NextResponse.json(
                { ok: false, error: "Invalid JSON body" },
                { status: 400 },
            );
        }

        if (typeof body.archived !== "boolean") {
            return NextResponse.json(
                { ok: false, error: "`archived` must be a boolean" },
                { status: 400 },
            );
        }

        const db = getAdminDb();

        // kloner_users/{uid}/kloner_renders/{renderId}
        const userDocRef = db.collection("kloner_users").doc(uid);
        const renderRef = userDocRef.collection("kloner_renders").doc(renderId);

        const snap = await renderRef.get();

        if (!snap.exists) {
            return NextResponse.json(
                { ok: false, error: "Render not found for this user" },
                { status: 404 },
            );
        }

        const data = snap.data() as { uid?: string } | undefined;
        if (data?.uid && data.uid !== uid) {
            return NextResponse.json(
                { ok: false, error: "Render does not belong to current user" },
                { status: 403 },
            );
        }

        const now = new Date();

        await renderRef.update({
            archived: body.archived,
            updatedAt: now,
        });

        return NextResponse.json({ ok: true });
    });
}
