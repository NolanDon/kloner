export {};

jest.mock("next/server", () => {
    return {
        __esModule: true,
        NextResponse: {
            json: (body: any, init?: { status?: number }) => {
                return {
                    status: init?.status ?? 200,
                    async json() {
                        return body;
                    },
                };
            },
        },
    };
});

const appRefGet = jest.fn();
const appRefUpdate = jest.fn();
const blobWhere = jest.fn();
const blobLimit = jest.fn();
const blobGet = jest.fn();
const blobAdd = jest.fn();
const blobSet = jest.fn();
const buildAppBuilderFileStoragePath = jest.fn(() => "kloner_app_files/uid_1/app_123/storage-object.txt");
const writeStorageText = jest.fn().mockResolvedValue(undefined);
const blobCol = {
    where: (...args: any[]) => blobWhere(...args),
    add: (...args: any[]) => blobAdd(...args),
};
const appRef = {
    get: (...args: any[]) => appRefGet(...args),
    update: (...args: any[]) => appRefUpdate(...args),
    collection: jest.fn(() => blobCol),
};

const collectionKlonerApps = jest.fn(() => ({
    doc: () => appRef,
}));
const collectionKlonerUsers = jest.fn(() => ({
    doc: () => ({
        collection: collectionKlonerApps,
    }),
}));
const getAdminDb = jest.fn(() => ({
    collection: collectionKlonerUsers,
}));

jest.mock("../../../_lib/route-guard", () => {
    return {
        __esModule: true,
        requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ uid: "uid_1", req: _req }),
    };
});

jest.mock("../../../_lib/auth", () => {
    return {
        __esModule: true,
        getAdminDb: () => getAdminDb(),
    };
});

jest.mock("../../../_lib/appBuilderScope", () => {
    return {
        __esModule: true,
        assertAppBuilderScope: () => undefined,
    };
});

jest.mock("../../../_lib/htmlStorage", () => {
    return {
        __esModule: true,
        buildAppBuilderFileStoragePath,
        writeStorageText,
    };
});

describe("POST /api/app-builder/[appId]/update-file", () => {
    beforeEach(() => {
        appRefGet.mockReset();
        appRefUpdate.mockReset();
        blobWhere.mockReset();
        blobLimit.mockReset();
        blobGet.mockReset();
        blobAdd.mockReset();
        blobSet.mockReset();
        collectionKlonerUsers.mockClear();
        collectionKlonerApps.mockClear();
        getAdminDb.mockClear();

        blobWhere.mockReturnValue({ limit: blobLimit });
        blobLimit.mockReturnValue({ get: blobGet });
        blobGet.mockResolvedValue({ empty: true, docs: [] });
        blobAdd.mockResolvedValue(undefined);
        blobSet.mockResolvedValue(undefined);
        buildAppBuilderFileStoragePath.mockClear();
        writeStorageText.mockClear();
        appRefUpdate.mockResolvedValue(undefined);
    });

    it("writes sharded files to the shard collection without rewriting the full files map", async () => {
        appRefGet.mockResolvedValue({
            exists: true,
            data: () => ({
                fileStorageMode: "sharded",
                fileStorageCollection: "file_blobs",
                files: {
                    "index.html": { content: "", lastModified: 1 },
                },
            }),
        });

        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({
                path: "index.html",
                content: "<html><body>updated</body></html>",
            }),
        };

        const res: any = await POST(req, { params: Promise.resolve({ appId: "app_123" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(blobWhere).toHaveBeenCalledWith("path", "==", "index.html");
        expect(blobAdd).toHaveBeenCalledTimes(1);
        expect(blobAdd.mock.calls[0][0]).toMatchObject({
            path: "index.html",
            content: "<html><body>updated</body></html>",
            encoding: "utf8",
            kind: "text",
            inline: true,
        });
        expect(appRefUpdate).toHaveBeenCalledTimes(1);
        expect(appRefUpdate.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                updatedAt: expect.any(Date),
            })
        );
        expect(appRefUpdate.mock.calls[0][0]).not.toHaveProperty("files");
    });

    it("still rewrites inline files for non-sharded apps", async () => {
        appRefGet.mockResolvedValue({
            exists: true,
            data: () => ({
                files: {
                    "index.html": { content: "<html>old</html>", lastModified: 1 },
                },
            }),
        });

        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({
                path: "index.html",
                content: "<html>new</html>",
            }),
        };

        const res: any = await POST(req, { params: Promise.resolve({ appId: "app_123" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(blobAdd).not.toHaveBeenCalled();
        expect(appRefUpdate).toHaveBeenCalledTimes(1);
        expect(appRefUpdate.mock.calls[0][0]).toMatchObject({
            files: {
                "index.html": { content: "<html>new</html>", lastModified: expect.any(Number) },
            },
            updatedAt: expect.any(Date),
        });
    });

    it("stores oversized sharded files in storage instead of Firestore content fields", async () => {
        const oversizedContent = "<html>" + "x".repeat(900_500) + "</html>";
        appRefGet.mockResolvedValue({
            exists: true,
            data: () => ({
                fileStorageMode: "sharded",
                fileStorageCollection: "file_blobs",
                files: {},
            }),
        });

        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({
                path: "index.html",
                content: oversizedContent,
            }),
        };

        const res: any = await POST(req, { params: Promise.resolve({ appId: "app_123" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(buildAppBuilderFileStoragePath).toHaveBeenCalledWith({
            uid: "uid_1",
            appId: "app_123",
            filePath: "index.html",
        });
        expect(writeStorageText).toHaveBeenCalledWith({
            storagePath: "kloner_app_files/uid_1/app_123/storage-object.txt",
            content: oversizedContent,
            contentType: "text/html; charset=utf-8",
        });
        expect(blobAdd).toHaveBeenCalledTimes(1);
        expect(blobAdd.mock.calls[0][0]).toMatchObject({
            path: "index.html",
            storagePath: "kloner_app_files/uid_1/app_123/storage-object.txt",
            content: "",
            inline: false,
        });
    });
});
