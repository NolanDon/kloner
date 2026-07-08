import { fetchGalleryDocs } from "./gallery-feed";

describe("fetchGalleryDocs", () => {
    it("pages through gallery docs and filters approved builds without a composite query", async () => {
        const page1 = [
            { id: "old-unapproved", data: () => ({ approved: false, createdAt: 1 }) },
            { id: "old-approved", data: () => ({ approved: true, createdAt: 2 }) },
        ];
        const page2 = [
            { id: "new-approved", data: () => ({ approved: true, createdAt: 3 }) },
            { id: "newer-approved", data: () => ({ approved: true, createdAt: 4 }) },
        ];

        const collection = jest.fn(() => query);
        const query = {
            orderBy: jest.fn(() => query),
            limit: jest.fn(() => query),
            startAfter: jest.fn(() => {
                cursorSeen = true;
                return query;
            }),
            get: jest.fn(async () => {
                if (cursorSeen) {
                    return { docs: page2, empty: false };
                }

                return { docs: page1, empty: false };
            }),
        } as any;

        let cursorSeen = false;
        const db = { collection };

        const docs = await fetchGalleryDocs(db, {
            approvedOnly: true,
            limit: 3,
            pageSize: 2,
        });

        expect(collection).toHaveBeenCalledWith("gallery");
        expect(query.orderBy).toHaveBeenCalledWith("createdAt", "desc");
        expect(query.limit).toHaveBeenCalledWith(2);
        expect(query.startAfter).toHaveBeenCalledTimes(1);
        expect(docs.map((doc) => doc.id)).toEqual([
            "old-approved",
            "new-approved",
            "newer-approved",
        ]);
    });
});
