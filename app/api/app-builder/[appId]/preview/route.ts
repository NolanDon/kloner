import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preview deployments have been removed. Only live (production) deploys are supported.
// This route remains as a compatibility stub so old clients fail safely.
export async function POST(req: NextRequest, { params }: { params: { appId: string } }) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = params.appId;
            assertAppBuilderScope(authedReq, uid, appId);

            return NextResponse.json(
                {
                    ok: false,
                    error: "Preview deployments are disabled. Use live deploys instead.",
                    code: "preview_deploy_disabled",
                },
                { status: 410 },
            );
        },
        { csrf: true, methods: ["POST"] },
    );
}
