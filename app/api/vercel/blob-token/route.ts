import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { loadVercelBlobReadWriteToken, saveVercelBlobReadWriteToken } from "../../_lib/vercel-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeToken(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const token = value.trim();
    return token || null;
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const db = getAdminDb();
            const ref = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("vercel");

            const result = await loadVercelBlobReadWriteToken(ref as any);
            return NextResponse.json(
                {
                    configured: Boolean(result.blobReadWriteToken),
                },
                { status: 200 },
            );
        },
        { methods: ["GET"], csrf: false },
    );
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const token = normalizeToken(body?.token);

            if (!token) {
                return NextResponse.json(
                    { ok: false, error: "Missing Vercel Blob token" },
                    { status: 400 },
                );
            }

            const db = getAdminDb();
            const ref = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("vercel");

            await saveVercelBlobReadWriteToken(ref as any, token);

            return NextResponse.json({ ok: true }, { status: 200 });
        },
        { methods: ["POST"], csrf: true },
    );
}

export async function DELETE(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const db = getAdminDb();
            const ref = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("vercel");

            await ref.set(
                {
                    blobReadWriteToken: null,
                },
                { merge: true },
            );

            return NextResponse.json({ ok: true }, { status: 200 });
        },
        { methods: ["DELETE"], csrf: true },
    );
}
