// app/api/gallery/list/route.ts
import { NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CommunityBuildPage = {
    id: string;
    title?: string;
    html: string;
};

export async function GET() {
    try {
        const db = await getAdminDb();

        const snap = await db
            .collection("gallery")
            .where("approved", "==", true)
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();

        if (snap.empty) {
            return NextResponse.json({ items: [] });
        }

        const items = snap.docs.map((doc) => {
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
                createdAt: data.createdAt?.toMillis?.() ?? null,
                remixable: !!data.remixable,
                approved: !!data.approved,
                screenshotKey: data.screenshotKey ?? null,
                screenshotUrl: data.screenshotUrl ?? null,
                html: data.html ?? null,
                pages,
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
