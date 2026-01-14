// app/api/app-builder/[appId]/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
    vercelProtectionBypassSecret?: string | null;
};

function normalizeSecret(raw: unknown): string | null {
    if (raw == null) return null;
    if (typeof raw !== "string") return null;
    const v = raw.trim();
    if (!v) return null;
    // Keep a reasonable upper bound; Vercel secrets are short.
    if (v.length > 512) {
        throw Object.assign(new Error("Secret is too long"), { status: 400 });
    }
    return v;
}

export async function POST(req: NextRequest, { params }: { params: { appId: string } }) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = params.appId;
            assertAppBuilderScope(authedReq, uid, appId);

            const body = (await authedReq.json().catch(() => ({}))) as Body;

            let vercelProtectionBypassSecret: string | null = null;
            try {
                vercelProtectionBypassSecret = normalizeSecret(body?.vercelProtectionBypassSecret);
            } catch (e: any) {
                return NextResponse.json(
                    { ok: false, error: e?.message || "Invalid secret" },
                    { status: e?.status || 400 },
                );
            }

            const db = getAdminDb();
            const ref = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId);

            const snap = await ref.get();
            if (!snap.exists) {
                return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
            }

            const update: Record<string, any> = {
                vercelProtectionBypassSecret,
                updatedAt: new Date(),
            };

            await ref.update(update);

            return NextResponse.json(
                {
                    ok: true,
                    vercelProtectionBypassSecret,
                    hasVercelProtectionBypassSecret: Boolean(vercelProtectionBypassSecret),
                },
                { status: 200 },
            );
        },
        { methods: ["POST"], csrf: true },
    );
}
