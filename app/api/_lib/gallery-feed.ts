type GalleryDoc = {
    id: string;
    data(): any;
};

type GalleryFeedOptions = {
    approvedOnly?: boolean;
    limit?: number;
    pageSize?: number;
};

function normalizeLimit(v: number | undefined, fallback: number) {
    const n = typeof v === "number" ? v : fallback;
    return Math.max(1, Math.min(200, n));
}

export async function fetchGalleryDocs(db: any, options: GalleryFeedOptions = {}) {
    const approvedOnly = options.approvedOnly ?? false;
    const limit = normalizeLimit(options.limit, 50);
    const pageSize = normalizeLimit(options.pageSize, 200);

    const docs: GalleryDoc[] = [];
    let cursor: any | null = null;

    while (docs.length < limit) {
        let q = db.collection("gallery").orderBy("createdAt", "desc").limit(pageSize);
        if (cursor) q = q.startAfter(cursor);

        const snap = await q.get();
        const pageDocs = Array.isArray(snap?.docs) ? snap.docs : [];
        if (!pageDocs.length) break;

        cursor = pageDocs[pageDocs.length - 1];

        for (const doc of pageDocs) {
            const data = doc.data?.() || {};
            if (approvedOnly && data.approved !== true) continue;
            docs.push(doc);
            if (docs.length >= limit) break;
        }

        if (pageDocs.length < pageSize) break;
    }

    return docs;
}
