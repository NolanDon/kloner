import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { assertAppBuilderScope } from "@/app/api/_lib/appBuilderScope";

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

        return NextResponse.json({ ok: true, restorePoints: items }, { status: 200 });
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

            const db = getAdminDb();
            const appRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId);

            const snap = await appRef.get();
            if (!snap.exists) {
                return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
            }

            const app = snap.data() as any;
            const files = (app?.files || {}) as Record<string, { content: string; lastModified: number }>;

            // Manual restore point captures current state for all files.
            // Guardrails: cap file count and total stored bytes.
            const MAX_FILES = 200;
            const MAX_TOTAL = 1_500_000; // ~1.5MB

            const before: Record<string, string | null> = {};
            let total = 0;

            for (const [path, file] of Object.entries(files).slice(0, MAX_FILES)) {
                const content = typeof (file as any)?.content === "string" ? (file as any).content : "";
                total += content.length;
                if (total > MAX_TOTAL) break;
                before[path] = content;
            }

            const docRef = appRef.collection("restore_points").doc();
            await docRef.set({
                label,
                source: "manual",
                kept: false,
                createdAt: new Date(),
                paths: Object.keys(before),
                before,
            });

            return NextResponse.json({ ok: true, restorePointId: docRef.id }, { status: 200 });
        },
        { csrf: true, methods: ["POST"] }
    );
}
