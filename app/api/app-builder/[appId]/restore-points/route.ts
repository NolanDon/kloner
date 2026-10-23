import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { assertAppBuilderScope } from "@/app/api/_lib/appBuilderScope";
import { WORKSPACE_RESTORE_COLLECTION, workspaceRestoreDetails, workspaceRestoreMetadata } from "@/app/api/_lib/workspaceRestorePoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RestorePointDoc = {
    id: string;
    createdAt: any;
    label: string;
    source?: string;
    kept?: boolean;
    paths?: string[];
    undoOf?: string | null;
    before?: Record<string, string | null>;
    after?: Record<string, string>;
};

function safeString(v: unknown, max = 200): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function GET(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const appId = safeString((await Promise.resolve(params))?.appId, 200);
        const url = new URL(authedReq.url);
        const restoreId = safeString(url.searchParams.get("restoreId"), 200);
        assertAppBuilderScope(authedReq, uid, appId);

        const db = getAdminDb();
        const col = db
            .collection("kloner_users")
            .doc(uid)
            .collection("kloner_apps")
            .doc(appId)
            .collection("restore_points");

        if (restoreId) {
            const doc = await col.doc(restoreId).get();
            if (!doc.exists) {
                const workspaceDoc = await col.parent!.collection(WORKSPACE_RESTORE_COLLECTION).doc(restoreId).get();
                if (workspaceDoc.exists) return NextResponse.json(await workspaceRestoreDetails(workspaceDoc));
                return NextResponse.json({ ok: false, error: "Restore point not found" }, { status: 404 });
            }

            const data = doc.data() as any;
            const response: RestorePointDoc & { ok: true } = {
                ok: true,
                id: doc.id,
                createdAt: data?.createdAt || null,
                label: safeString(data?.label, 400) || "Restore point",
                source: safeString(data?.source, 60) || undefined,
                kept: Boolean(data?.kept),
                paths: Array.isArray(data?.paths) ? data.paths.slice(0, 200) : undefined,
                undoOf: typeof data?.undoOf === "string" ? data.undoOf : null,
                before: data?.before && typeof data.before === "object" ? data.before : undefined,
                after: data?.after && typeof data.after === "object" ? data.after : undefined,
            };

            return NextResponse.json(response, { status: 200 });
        }

        const snap = await col.orderBy("createdAt", "desc").limit(25).get();
        const items: RestorePointDoc[] = snap.docs.map((d: any) => {
            const data = d.data() as any;
            return {
                id: d.id,
                createdAt: data?.createdAt || null,
                label: safeString(data?.label, 400) || "Restore point",
                source: safeString(data?.source, 60) || undefined,
                kept: Boolean(data?.kept),
                paths: Array.isArray(data?.paths) ? data.paths.slice(0, 200) : undefined,
                undoOf: typeof data?.undoOf === "string" ? data.undoOf : null,
            };
        });

        const workspace = await col.parent!.collection(WORKSPACE_RESTORE_COLLECTION).orderBy("createdAt", "desc").limit(25).get();
        const time = (value: any) => typeof value?.toMillis === "function" ? value.toMillis() : Date.parse(value) || 0;
        const combined = [...items, ...workspace.docs.map(workspaceRestoreMetadata)]
            .sort((a, b) => time(b.createdAt) - time(a.createdAt)).slice(0, 25);
        return NextResponse.json({ ok: true, restorePoints: combined }, { status: 200 });
    });
}

export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = safeString((await Promise.resolve(params))?.appId, 200);
            assertAppBuilderScope(authedReq, uid, appId);

            const body = await req.json().catch(() => ({} as any));
            const label = safeString(body?.label, 400) || "Manual restore point";
            const requestedPaths: string[] = Array.isArray(body?.paths)
                ? Array.from(new Set((body.paths as unknown[]).map((path) => safeString(path, 400)).filter((path): path is string => Boolean(path))))
                : [];

            // Capture through the same binary-safe, sharded backend used by agent
            // undo. No inline document limits or partial full-snapshot truncation.
            const result = await callBackend(authedReq, {
                path: "/app-embeddings/agent-v3/restore-points",
                method: "POST", timeoutMs: 180_000, userCtx: { uid },
                body: { appId, paths: requestedPaths, label },
            });
            return NextResponse.json(result.json, { status: result.status });
        },
        { csrf: true, methods: ["POST"] }
    );
}
