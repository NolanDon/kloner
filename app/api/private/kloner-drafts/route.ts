import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const draftsSnap = await db.collection("kloner_users").doc(uid).collection("kloner_drafts").get();

        const drafts = draftsSnap.docs.map((docSnap) => {
            const draftData = docSnap.data() as any;
            return {
                draftId: docSnap.id,
                id: typeof draftData?.id === "string" && draftData.id.trim() ? draftData.id.trim() : docSnap.id,
                name: typeof draftData?.name === "string" && draftData.name.trim()
                    ? draftData.name.trim()
                    : (typeof draftData?.sourceUrl === "string" && draftData.sourceUrl.trim()
                        ? draftData.sourceUrl.trim()
                        : docSnap.id),
                createdAt: draftData?.createdAt ?? null,
                updatedAt: draftData?.updatedAt ?? draftData?.createdAt ?? null,
                sourceUrl: typeof draftData?.sourceUrl === "string" ? draftData.sourceUrl : null,
                retryable: Boolean(draftData?.retryable),
                completed: Boolean(draftData?.completed),
                warningCode: typeof draftData?.warningCode === "string" ? draftData.warningCode : null,
                warningMessage: typeof draftData?.warningMessage === "string" ? draftData.warningMessage : null,
                warningAction: typeof draftData?.warningAction === "string" ? draftData.warningAction : null,
                errorCode: typeof draftData?.errorCode === "string" ? draftData.errorCode : null,
                errorMessage: typeof draftData?.errorMessage === "string" ? draftData.errorMessage : null,
                errorReason: typeof draftData?.errorReason === "string" ? draftData.errorReason : null,
                userMessage: typeof draftData?.userMessage === "string" ? draftData.userMessage : null,
                details: draftData?.details ?? null,
                warnings: Array.isArray(draftData?.warnings) ? draftData.warnings : [],
                blocked: Boolean(draftData?.blocked),
            };
        });

        drafts.sort((left, right) => {
            const leftTime = typeof left.createdAt === "number" ? left.createdAt : 0;
            const rightTime = typeof right.createdAt === "number" ? right.createdAt : 0;
            return rightTime - leftTime;
        });

        return NextResponse.json({ ok: true, drafts });
    });
}