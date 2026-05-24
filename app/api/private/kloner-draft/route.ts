import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftPayload = {
    id: string;
    name: string;
    createdAt: number;
    sourceUrl?: string | null;
    retryable?: boolean;
    completed?: boolean;
    warningCode?: string | null;
    warningMessage?: string | null;
    warningAction?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    errorReason?: string | null;
    userMessage?: string | null;
    details?: unknown;
    warnings?: unknown[];
    blocked?: boolean;
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const body = (await authedReq.json().catch(() => ({}))) as {
            action?: string;
            draft?: DraftPayload;
            draftId?: string;
            clearIssue?: boolean;
        };

        const action = String(body?.action || "upsert").toLowerCase().trim();
        const db = getAdminDb();
        const draftsCol = db.collection("kloner_users").doc(uid).collection("kloner_drafts");
        const draftId = String(body?.draftId || body?.draft?.id || "").trim() || draftsCol.doc().id;
        const draftRef = draftsCol.doc(draftId);

        if (action === "delete") {
            await draftRef.delete().catch(() => null);
            return NextResponse.json({ ok: true, draftId });
        }

        const draft = body?.draft;
        if (!draft || typeof draft.id !== "string" || typeof draft.name !== "string") {
            return NextResponse.json({ error: "Missing draft payload" }, { status: 400 });
        }

        const clearIssue = Boolean(body?.clearIssue);
        const draftData = {
            draftId,
            id: draft.id,
            name: draft.name,
            createdAt: typeof draft.createdAt === "number" ? draft.createdAt : Date.now(),
            sourceUrl: typeof draft.sourceUrl === "string" ? draft.sourceUrl : null,
            retryable: clearIssue ? false : Boolean(draft.retryable),
            completed: Boolean(draft.completed),
            warningCode: clearIssue ? null : (typeof draft.warningCode === "string" ? draft.warningCode : null),
            warningMessage: clearIssue ? null : (typeof draft.warningMessage === "string" ? draft.warningMessage : null),
            warningAction: clearIssue ? null : (typeof draft.warningAction === "string" ? draft.warningAction : null),
            errorCode: clearIssue ? null : (typeof draft.errorCode === "string" ? draft.errorCode : null),
            errorMessage: clearIssue ? null : (typeof draft.errorMessage === "string" ? draft.errorMessage : null),
            errorReason: clearIssue ? null : (typeof draft.errorReason === "string" ? draft.errorReason : null),
            userMessage: clearIssue ? null : (typeof draft.userMessage === "string" ? draft.userMessage : null),
            details: clearIssue ? null : draft.details ?? null,
            warnings: clearIssue ? [] : (Array.isArray(draft.warnings) ? draft.warnings : []),
            blocked: clearIssue ? false : Boolean(draft.blocked),
            updatedAt: new Date(),
        };

        await draftRef.set(draftData, { merge: true });

        return NextResponse.json({ ok: true, draftId });
    });
}