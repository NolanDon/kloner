import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { assertAppBuilderScope } from "@/app/api/_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEnvPath(path: string): boolean {
    const lower = String(path || "").toLowerCase();
    const base = lower.split("/").pop() || lower;
    return base === ".env" || base.startsWith(".env.");
}

function safeString(v: unknown, max = 200): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function captureSnapshot(files: Record<string, { content: string; lastModified: number }>): {
    before: Record<string, string | null>;
    paths: string[];
} {
    // Guardrails: cap file count and total stored bytes.
    const MAX_FILES = 200;
    const MAX_TOTAL = 1_500_000; // ~1.5MB

    const before: Record<string, string | null> = {};
    let total = 0;

    for (const [path, file] of Object.entries(files).slice(0, MAX_FILES)) {
        if (isEnvPath(path)) continue;
        const content = typeof (file as any)?.content === "string" ? (file as any).content : "";
        total += content.length;
        if (total > MAX_TOTAL) break;
        before[path] = content;
    }

    return { before, paths: Object.keys(before) };
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

            // Manual restore points are full snapshots (best-effort within guardrails).
            // Apply them by replacing the entire files map, so files created after the snapshot are removed.
            const isSnapshot = String(rp?.source || "").toLowerCase() === "manual" || rp?.snapshot === true;

            const app = appSnap.data() as any;
            const files = (app?.files || {}) as Record<string, { content: string; lastModified: number }>;

            // Create an automatic inverse restore point so the user can redo.
            // For snapshot restores, capture the full current state (within limits) for predictable redo.
            const inverseCapture = isSnapshot ? captureSnapshot(files) : null;
            const inverse: Record<string, string | null> = {};
            const inversePaths: string[] = [];
            if (inverseCapture) {
                Object.assign(inverse, inverseCapture.before);
                inversePaths.push(...inverseCapture.paths);
            } else {
                for (const p of paths) {
                    if (isEnvPath(p)) continue;
                    if (Object.prototype.hasOwnProperty.call(files, p)) {
                        inverse[p] = typeof files[p]?.content === "string" ? files[p].content : "";
                    } else {
                        inverse[p] = null;
                    }
                }
                inversePaths.push(...paths);
            }

            // Apply restore
            let nextFiles: Record<string, { content: string; lastModified: number }> = files;
            if (isSnapshot) {
                nextFiles = {};
            }

            for (const p of paths) {
                if (isEnvPath(p)) continue;
                const v = before[p];
                if (v === null) {
                    if (!isSnapshot) delete nextFiles[p];
                    // In snapshot mode, absence is represented by not being present.
                } else {
                    nextFiles[p] = { content: v, lastModified: Date.now() };
                }
            }

            await appRef.update({ files: nextFiles, updatedAt: new Date() });

            const inverseRef = appRef.collection("restore_points").doc();
            await inverseRef.set({
                label: `Undo: ${safeString(rp?.label, 200) || "restore"}`,
                source: "undo",
                kept: false,
                createdAt: new Date(),
                snapshot: Boolean(isSnapshot),
                paths: inversePaths,
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
