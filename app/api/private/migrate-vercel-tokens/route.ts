import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { loadVercelIntegration } from "@/app/api/_lib/vercel-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function requireInternal(req: NextRequest) {
    const key = process.env.INTERNAL_API_KEY || "";
    const got = req.headers.get("x-internal-key") || "";
    if (!key || got !== key) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
}

export async function POST(req: NextRequest) {
    const denied = requireInternal(req);
    if (denied) return denied;

    const db = getAdminDb();
    const snap = await db.collectionGroup("integrations").get();
    const vercelDocs = snap.docs.filter((doc) => doc.id === "vercel");

    let migrated = 0;
    let alreadyEncrypted = 0;
    let missingToken = 0;
    let failed = 0;

    for (const doc of vercelDocs) {
        try {
            const result = await loadVercelIntegration(doc.ref as any);
            if (!result.accessToken) {
                missingToken += 1;
                continue;
            }

            if (result.migrated) {
                migrated += 1;
            } else {
                alreadyEncrypted += 1;
            }
        } catch (error) {
            failed += 1;
            console.error("[vercel-token-migration] failed", { path: doc.ref.path, error });
        }
    }

    return NextResponse.json(
        {
            ok: failed === 0,
            scanned: vercelDocs.length,
            migrated,
            alreadyEncrypted,
            missingToken,
            failed,
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}