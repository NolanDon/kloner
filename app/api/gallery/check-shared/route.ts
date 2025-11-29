// app/api/gallery/check-shared/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const { searchParams } = new URL(req.url);
            const renderId = searchParams.get("renderId");

            if (!renderId) {
                return NextResponse.json(
                    { error: "Missing renderId" },
                    { status: 400 }
                );
            }

            const db = await getAdminDb();

            // Only check for docs this user authored
            const snap = await db
                .collection("gallery")
                .where("sourceRenderId", "==", renderId)
                .where("author", "==", uid)
                .limit(1)
                .get();

            const alreadyShared = !snap.empty;

            return NextResponse.json(
                { alreadyShared },
                {
                    status: 200,
                    headers: {
                        "cache-control": "no-store",
                    },
                }
            );
        },
        { methods: ["GET"] }
    );
}
