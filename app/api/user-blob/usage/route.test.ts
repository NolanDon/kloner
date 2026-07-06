export {};

jest.mock("next/server", () => {
    return {
        __esModule: true,
        NextResponse: {
            json: (body: any, init?: { status?: number }) => ({
                status: init?.status ?? 200,
                async json() {
                    return body;
                },
            }),
        },
    };
});

jest.mock("../../_lib/route-guard", () => {
    return {
        __esModule: true,
        requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ uid: "uid_1", req: _req }),
    };
});

describe("GET /api/user-blob/usage", () => {
    const OLD_ENV = { ...process.env };
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV } as any;
        consoleErrorSpy.mockClear();
    });

    afterAll(() => {
        process.env = OLD_ENV;
        consoleErrorSpy.mockRestore();
    });

    it("returns file usage even when getFiles includes a non-iterable trailing payload", async () => {
        const getMetadata = jest.fn(async () => [{ size: "1234" }]);
        const bucketMock = {
            getFiles: jest.fn(async () => [[{ getMetadata }], { prefixes: ["ignored"] }, { anything: true }]),
        };

        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                storage: () => ({
                    bucket: () => bucketMock,
                }),
            },
        }));

        const { GET } = await import("./route");
        const res: any = await GET(new Request("https://example.com/api/user-blob/usage") as any);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.usedBytes).toBe(1234 * 3);
        expect(body.fileCount).toBe(3);
        expect(bucketMock.getFiles).toHaveBeenCalledTimes(3);
        expect(body.limitBytes).toBeGreaterThan(0);
    });

    it("falls back to zero usage when the bucket lookup fails", async () => {
        const bucketMock = {
            getFiles: jest.fn(async () => {
                throw new Error("boom");
            }),
        };

        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                storage: () => ({
                    bucket: () => bucketMock,
                }),
            },
        }));

        const { GET } = await import("./route");
        const res: any = await GET(new Request("https://example.com/api/user-blob/usage") as any);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.usedBytes).toBe(0);
        expect(body.fileCount).toBe(0);
    });
});
