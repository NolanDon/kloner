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
            const appRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId);

            const rpRef = appRef.collection("restore_points").doc(restoreId);

            const [appSnap, rpSnap] = await Promise.all([appRef.get(), rpRef.get()]);
            if (!appSnap.exists) {
                return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
            }
            if (!rpSnap.exists) {
                return NextResponse.json({ ok: false, error: "Restore point not found" }, { status: 404 });
            }

            const rp = rpSnap.data() as any;
            const before = (rp?.before || {}) as Record<string, string | null>;
            const paths = Object.keys(before);
            if (!paths.length) {
                return NextResponse.json({ ok: false, error: "Restore point is empty" }, { status: 400 });
            }

            const app = appSnap.data() as any;
            const files = (app?.files || {}) as Record<string, { content: string; lastModified: number }>;

            // Create an automatic "undo-of-undo" restore point so the user can re-apply.
            const inverse: Record<string, string | null> = {};
            for (const p of paths) {
                if (Object.prototype.hasOwnProperty.call(files, p)) {
                    inverse[p] = typeof files[p]?.content === "string" ? files[p].content : "";
                } else {
                    inverse[p] = null;
                }
            }

            // Apply restore
            for (const p of paths) {
                const v = before[p];
                if (v === null) {
                    delete files[p];
                } else {
                    files[p] = { content: v, lastModified: Date.now() };
                }
            }

            await appRef.update({ files, updatedAt: new Date() });

            const inverseRef = appRef.collection("restore_points").doc();
            await inverseRef.set({
                label: `Undo: ${safeString(rp?.label, 200) || "restore"}`,
                source: "undo",
                kept: false,
                createdAt: new Date(),
                paths,
                before: inverse,
                undoOf: restoreId,
            });

            return NextResponse.json(
                {
                    ok: true,
                    applied: paths.length,
                    newRestorePointId: inverseRef.id,
                },
                { status: 200 }
            );
        },
        { csrf: true, methods: ["POST"] }
    );
}
