import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const { appId } = await params;
        assertAppBuilderScope(authedReq, uid, appId);

        const db = getAdminDb();
        const userSnap = await db.doc(`kloner_users/${uid}`).get();
        const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
        const billingState = String(userData.stripeStatus || "free").trim().toLowerCase();

        if (billingState === "trialing") {
            return NextResponse.json(
                {
                    code: "PAID_SUBSCRIPTION_REQUIRED",
                    billingState,
                    error: "A trial user clicked Deploy and was shown the paid subscription paywall.",
                },
                { status: 402 },
            );
        }

        return NextResponse.json({ ok: true }, { status: 200 });
    }, { csrf: true, methods: ["POST"] });
}
