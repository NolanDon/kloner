// app/api/gallery/approved/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();

        // IMPORTANT: root collection "gallery", not collectionGroup, no extra path
        const snap = await db
            .collection("gallery")
            .where("approved", "==", true) // boolean match
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();

        const items = snap.docs.map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                name: data.name ?? "Untitled",
                html: data.html ?? "",
                author: data.author ?? null,
                createdAt: data.createdAt?.toMillis
                    ? data.createdAt.toMillis()
                    : null,
                screenshotKey: data.screenshotKey ?? null,
                remixable: data.remixable ?? false,
                ...data,
            };
        });

        return NextResponse.json(
            {
                items,
                count: items.length,
            },
            { status: 200 },
        );
    });
}
