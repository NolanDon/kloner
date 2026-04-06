import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../../_lib/appBuilderScope";
import { restartPreview } from "@/src/lib/restartPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = (await Promise.resolve(params))?.appId;

            // Prevent request tampering: must match the active app scope cookie.
            assertAppBuilderScope(authedReq, uid, appId);

            const body = await authedReq.json().catch(() => ({} as any));
            const requestedCode = typeof body?.code === "string" ? body.code.trim() : "";
            const subset = body?.files && typeof body.files === "object" ? body.files : undefined;

            const db = getAdminDb();
            const appRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
            const snap = await appRef.get();
            if (!snap.exists) {
                console.warn("[preview/restart] app not found", { uid, appId });
                return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
            }

            const data = (snap.data() as any) || {};
            const storedCode = typeof data?.containerCode === "string" ? data.containerCode.trim() : "";
            const code = requestedCode || storedCode;

            if (!code) {
                const debug = process.env.NODE_ENV !== "production"
                    ? {
                          hasRequestedCode: Boolean(requestedCode),
                          requestedCodeLen: requestedCode.length,
                          hasStoredCode: Boolean(storedCode),
                          storedCodeLen: storedCode.length,
                      }
                    : undefined;

                console.warn("[preview/restart] no active code", { uid, appId, ...debug });
                return NextResponse.json(
                    { ok: false, error: "No active preview found (create a preview first).", debug },
                    { status: 404 },
                );
            }

            // If the browser supplies a code, ensure it matches the one bound to this app.
            if (requestedCode && storedCode && requestedCode !== storedCode) {
                return NextResponse.json(
                    { ok: false, error: "Preview code mismatch. Your preview may have expired." },
                    { status: 409 },
                );
            }

            const restarted = await restartPreview({
                req: authedReq,
                code,
                appId,
                uid,
                files: subset,
            });

            const redactedUrl = (() => {
                try {
                    return String(restarted.url || "").replace(
                        /(\/api\/v1\/preview\/)[^\/]+(\/restart)/,
                        "$1<code>$2"
                    );
                } catch {
                    return "";
                }
            })();

            // Always log a redacted upstream URL for ops/debugging.
            console.log("[preview/restart] upstream", {
                url: redactedUrl || restarted.url,
                status: restarted.status,
                reqId: restarted.reqId,
            });

            if (!restarted.ok) {
                // Preserve common user-facing error statuses.
                const status = restarted.status || 400;
                return NextResponse.json(
                    {
                        ok: false,
                        error: restarted.error || "Failed to restart preview",
                        ...(process.env.NODE_ENV !== "production"
                            ? { upstream: { url: restarted.url, status: restarted.status, reqId: restarted.reqId } }
                            : {}),
                    },
                    { status },
                );
            }

            // Persist latest code for reconnects across sessions.
            try {
                const nextCode = String((restarted.json as any)?.code || code);
                await appRef.update({
                    containerCode: nextCode,
                    containerCodeTimestamp: Date.now(),
                    updatedAt: new Date(),
                });
            } catch (e) {
                console.warn("[preview/restart] failed to persist containerCode", e);
            }

            return NextResponse.json({
                ...(restarted.json as any),
                ...(process.env.NODE_ENV !== "production"
                    ? { upstream: { url: restarted.url, status: restarted.status, reqId: restarted.reqId } }
                    : {}),
            });
        },
        { csrf: true, methods: ["POST"] },
    );
}
