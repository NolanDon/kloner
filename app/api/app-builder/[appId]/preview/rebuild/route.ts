import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../../_lib/appBuilderScope";
import { rebuildPreview } from "@/src/lib/rebuildPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { appId: string } }) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = params.appId;

            // Prevent request tampering: must match the active app scope cookie.
            assertAppBuilderScope(authedReq, uid, appId);

            const body = await authedReq.json().catch(() => ({} as any));
            const requestedCode = typeof body?.code === "string" ? body.code.trim() : "";

            const db = getAdminDb();
            const appRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
            const snap = await appRef.get();
            if (!snap.exists) {
                console.warn("[preview/rebuild] app not found", { uid, appId });
                return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
            }

            const data = (snap.data() as any) || {};
            const storedCode = typeof data?.containerCode === "string" ? data.containerCode.trim() : "";

            // Prefer the caller-provided code (from localStorage). If it doesn't work,
            // retry without a code so the hub can resolve the latest preview for appId.
            const tryRebuild = async (codeToUse?: string) =>
                rebuildPreview({
                    req: authedReq,
                    code: codeToUse,
                    appId,
                    uid,
                });

            let rebuilt = await tryRebuild(requestedCode || storedCode || undefined);

            if (!rebuilt.ok && requestedCode && storedCode && requestedCode !== storedCode) {
                // Code mismatch could be stale Firestore or stale localStorage; retry letting hub decide.
                rebuilt = await tryRebuild(undefined);
            }

            const redactedUrl = (() => {
                try {
                    return String(rebuilt.url || "").replace(/(\/api\/v1\/preview\/)[^\/]+(\/rebuild)/, "$1<code>$2");
                } catch {
                    return "";
                }
            })();

            console.log("[preview/rebuild] upstream", {
                url: redactedUrl || rebuilt.url,
                status: rebuilt.status,
                reqId: rebuilt.reqId,
            });

            if (!rebuilt.ok) {
                const status = rebuilt.status || 400;
                return NextResponse.json(
                    {
                        ok: false,
                        error: rebuilt.error || "Failed to rebuild preview",
                        ...(process.env.NODE_ENV !== "production"
                            ? { upstream: { url: rebuilt.url, status: rebuilt.status, reqId: rebuilt.reqId } }
                            : {}),
                    },
                    { status },
                );
            }

            // Persist latest code if backend returns a different one.
            try {
                const nextCode = String((rebuilt.json as any)?.code || requestedCode || storedCode || "");
                if (nextCode) {
                    await appRef.update({
                        containerCode: nextCode,
                        containerCodeTimestamp: Date.now(),
                        updatedAt: new Date(),
                    });
                }
            } catch (e) {
                console.warn("[preview/rebuild] failed to persist containerCode", e);
            }

            return NextResponse.json({
                ...(rebuilt.json as any),
                ...(process.env.NODE_ENV !== "production"
                    ? { upstream: { url: rebuilt.url, status: rebuilt.status, reqId: rebuilt.reqId } }
                    : {}),
            });
        },
        { csrf: true, methods: ["POST"] },
    );
}
