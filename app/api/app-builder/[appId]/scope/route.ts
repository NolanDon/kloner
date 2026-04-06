import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { issueAppBuilderScopeCookie } from "../../../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const appId = (await Promise.resolve(params))?.appId;

        const doc = await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).get();
        if (!doc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const res = NextResponse.json({ ok: true, appId });
        issueAppBuilderScopeCookie(res, uid, appId);
        return res;
    });
}
