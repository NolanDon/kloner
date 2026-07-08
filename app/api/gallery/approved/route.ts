// app/api/gallery/approved/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { fetchGalleryDocs } from "../../_lib/gallery-feed";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async () => {
        const db = getAdminDb();
        const docs = await fetchGalleryDocs(db, { approvedOnly: true, limit: 50 });

        const items = docs.map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                name: data.name ?? "Untitled",
                html: data.html ?? "",
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
