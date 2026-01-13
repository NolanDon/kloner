import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { assertAppBuilderScope } from "@/app/api/_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeString(v: unknown, max = 200): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(
    req: NextRequest,
    { params }: { params: { appId: string; restoreId: string } }
) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = safeString(params.appId, 200);
            const restoreId = safeString(params.restoreId, 200);
            assertAppBuilderScope(authedReq, uid, appId);

            const db = getAdminDb();
            const rpRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId)
                .collection("restore_points")
                .doc(restoreId);

            const snap = await rpRef.get();
            if (!snap.exists) {
                return NextResponse.json({ ok: false, error: "Restore point not found" }, { status: 404 });
            }

            await rpRef.set({ kept: true }, { merge: true });
            return NextResponse.json({ ok: true }, { status: 200 });
        },
        { csrf: true, methods: ["POST"] }
    );
}
