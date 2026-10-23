import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { assertAppBuilderScope } from "@/app/api/_lib/appBuilderScope";
import { refreshTierFromStripeForUid } from "@/app/api/_lib/billing";
import { buildProjectDownload, canDownloadProject, isExportableProjectPath } from "@/app/api/_lib/projectDownload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const { appId } = await params;
        assertAppBuilderScope(authedReq, uid, appId);
        const db = getAdminDb();
        // Refresh from Stripe so a cached paid tier or trial claim cannot grant exports.
        await refreshTierFromStripeForUid(uid);
        const userRef = db.collection("kloner_users").doc(uid);
        const user = (await userRef.get()).data() || {};
        if (!canDownloadProject(user)) return NextResponse.json({
            code: "PAID_SUBSCRIPTION_REQUIRED", billingState: user.stripeStatus || "free", error: "Upgrade to a paid subscription to download your code.",
        }, { status: 402 });
        const snap = await userRef.collection("kloner_apps").doc(appId).get();
        if (!snap.exists) return NextResponse.json({ error: "App not found" }, { status: 404 });
        const body = await authedReq.json();
        const currentFile = body.currentFile;
        if (currentFile && (typeof currentFile.path !== "string" || !isExportableProjectPath(currentFile.path)
            || typeof currentFile.content !== "string")) {
            return NextResponse.json({ error: "Invalid current editor file" }, { status: 400 });
        }
        const app = snap.data();
        const archive = await buildProjectDownload({ db, uid, appId, app, currentFile });
        const name = String(app?.name || "project").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "project";
        return new NextResponse(Buffer.from(archive), { headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${name}.zip"`,
            "Cache-Control": "private, no-store",
        } });
    }, { csrf: true, methods: ["POST"] });
}
