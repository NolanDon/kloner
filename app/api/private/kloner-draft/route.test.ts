import { GET as getDrafts } from "../kloner-drafts/route";
import { POST as upsertDraft } from "./route";

const mockRouteGuard = jest.fn();
const mockGetAdminDb = jest.fn();

jest.mock("../../_lib/route-guard", () => ({
    requireSessionAndMaybeCsrf: (...args: any[]) => mockRouteGuard(...args),
}));

jest.mock("../../_lib/auth", () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

describe("private draft routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function buildDraftCollectionMock(set?: jest.Mock, deleteFn?: jest.Mock) {
        return {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    collection: jest.fn(() => ({
                        doc: jest.fn(() => ({
                            set: set || jest.fn(async () => undefined),
                            delete: deleteFn || jest.fn(async () => undefined),
                        })),
                    })),
                })),
            })),
        } as any;
    }

    it("upserts a draft document with the expected firestore shape", async () => {
        const set = jest.fn(async () => undefined);
        const db = buildDraftCollectionMock(set);
        mockGetAdminDb.mockReturnValue(db);

        mockRouteGuard.mockImplementation(async (_req: any, handler: any) => {
            return handler({
                uid: "user-123",
                req: {
                    json: async () => ({
                        action: "upsert",
                        draftId: "draft-1",
                        draft: {
                            id: "draft-1",
                            name: "Example Site",
                            createdAt: 123,
                            sourceUrl: "https://example.com",
                            retryable: false,
                            completed: true,
                            warnings: ["warn-1"],
                            blocked: false,
                        },
                    }),
                },
            });
        });

        const response = await upsertDraft({} as any);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, draftId: "draft-1" });
        expect(set).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({
            draftId: "draft-1",
            id: "draft-1",
            name: "Example Site",
            createdAt: 123,
            sourceUrl: "https://example.com",
            retryable: false,
            completed: true,
            warnings: ["warn-1"],
            blocked: false,
        }), { merge: true });
    });

    it("deletes a draft document when requested", async () => {
        const deleteFn = jest.fn(async () => undefined);
        const db = buildDraftCollectionMock(undefined, deleteFn);
        mockGetAdminDb.mockReturnValue(db);

        mockRouteGuard.mockImplementation(async (_req: any, handler: any) => {
            return handler({
                uid: "user-123",
                req: {
                    json: async () => ({ action: "delete", draftId: "draft-1" }),
                },
            });
        });

        const response = await upsertDraft({} as any);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, draftId: "draft-1" });
        expect(deleteFn).toHaveBeenCalledTimes(1);
    });

    it("returns newest-first drafts from the list route", async () => {
        mockGetAdminDb.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    collection: jest.fn(() => ({
                        get: jest.fn(async () => ({
                            docs: [
                                {
                                    id: "draft-old",
                                    data: () => ({
                                        id: "draft-old",
                                        name: "Old Draft",
                                        createdAt: 100,
                                        sourceUrl: "https://old.example.com",
                                    }),
                                },
                                {
                                    id: "draft-new",
                                    data: () => ({
                                        id: "draft-new",
                                        name: "New Draft",
                                        createdAt: 200,
                                        sourceUrl: "https://new.example.com",
                                    }),
                                },
                            ],
                        })),
                    })),
                })),
            })),
        } as any);

        mockRouteGuard.mockImplementation(async (_req: any, handler: any) => handler({ uid: "user-123" }));

        const response = await getDrafts({} as any);
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.drafts).toHaveLength(2);
        expect(payload.drafts[0].draftId).toBe("draft-new");
        expect(payload.drafts[1].draftId).toBe("draft-old");
    });
});
