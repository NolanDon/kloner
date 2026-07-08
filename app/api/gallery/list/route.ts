// app/api/gallery/list/route.ts
import { NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { fetchGalleryDocs } from "../../_lib/gallery-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CommunityBuildPage = {
    id: string;
    title?: string;
    html: string;
};

function toNum(v: unknown, fallback = 0) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
}

export async function GET() {
    try {
        const db = await getAdminDb();
        const docs = await fetchGalleryDocs(db, { approvedOnly: true, limit: 50 });

        if (!docs.length) {
            return NextResponse.json({ items: [] });
        }

        const items = docs.map((doc) => {
            const data = doc.data() as any;

            const pages: CommunityBuildPage[] | null =
                Array.isArray(data.pages) && data.pages.length
                    ? data.pages.map((p: any, idx: number) => ({
                        id: String(p.id ?? idx),
                        title: typeof p.title === "string" ? p.title : undefined,
                        html: String(p.html ?? ""),
                    }))
                    : null;

            return {
                id: doc.id,
                renderId: data.sourceRenderId ?? data.renderId ?? null,
                name: data.name || "Untitled build",
                author: data.author ?? null,
                createdAt: data.createdAt?.toMillis?.() ?? null,
                remixable: !!data.remixable,
                approved: !!data.approved,
                screenshotKey: data.screenshotKey ?? null,
                screenshotUrl: data.screenshotUrl ?? null,
                html: data.html ?? null,
                pages,

                // ✅ FIX: include stored counters so the UI can render initial values
                views: toNum(data.views, 0),
                likes: toNum(data.likes, 0),
                remixes: toNum(data.remixes, 0),

                // optional; keep consistent with your client type
                likedByMe: false,
            };
        });

        return NextResponse.json({ items });
    } catch (err: any) {
        console.error("[gallery/list] error", err);
        return NextResponse.json(
            { error: err?.message || "Failed to load community builds" },
            { status: 500 },
        );
    }
}
