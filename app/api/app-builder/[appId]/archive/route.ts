// app/api/app-builder/[appId]/archive/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { assertAppBuilderScope } from "@/app/api/_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    { params }: { params: { appId: string } }
) {
    return requireSessionAndMaybeCsrf(
        request,
        async ({ uid, req: authedReq }) => {
            const db = getAdminDb();
            const appId = params.appId;

            assertAppBuilderScope(authedReq, uid, appId);

            const body = await request.json().catch(() => ({}));
            const archived = (body as any)?.archived;

            if (typeof archived !== "boolean") {
                return NextResponse.json(
                    { error: "Invalid archived flag" },
                    { status: 400 }
                );
            }

            const appRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId);

            const snap = await appRef.get();
            if (!snap.exists) {
                return NextResponse.json(
                    { error: "App not found" },
                    { status: 404 }
                );
            }

            await appRef.update({
                archived,
                archivedAt: archived ? new Date() : null,
                updatedAt: new Date(),
            });

            return NextResponse.json({ success: true });
        },
        { csrf: true, methods: ["POST"] }
    );
}
