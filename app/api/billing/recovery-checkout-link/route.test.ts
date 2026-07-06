export {};

const makeSignedToken = jest.fn();
const requireSessionAndMaybeCsrf = jest.fn();

jest.mock("../../_lib/route-guard", () => ({
    __esModule: true,
    requireSessionAndMaybeCsrf: (...args: any[]) => requireSessionAndMaybeCsrf(...args),
}));

jest.mock("@/app/api/private/email-links", () => ({
    __esModule: true,
    makeSignedToken: (...args: any[]) => makeSignedToken(...args),
}));

jest.mock("next/server", () => ({
    __esModule: true,
    NextResponse: {
        json: (body: any, init?: { status?: number }) =>
            ({
                status: init?.status ?? 200,
                headers: new Headers(),
                async json() {
                    return body;
                },
            }) as any,
        redirect: (url: string, status = 302) =>
            new Response(null, {
                status,
                headers: { Location: url },
            }),
    },
}));

describe("GET /api/billing/recovery-checkout-link", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        makeSignedToken.mockReturnValue("token");
        requireSessionAndMaybeCsrf.mockImplementation(async (_req: any, handler: any) =>
            handler({ uid: "uid_123" }),
        );
    });

    it("redirects authenticated users to the signed recovery checkout URL", async () => {
        const { GET } = await import("./route");

        const res: any = await GET(new Request("https://example.com/api/billing/recovery-checkout-link") as any);

        expect(requireSessionAndMaybeCsrf).toHaveBeenCalledTimes(1);
        expect(makeSignedToken).toHaveBeenCalledWith({ uid: "uid_123", k: "exit40", ts: expect.any(Number) });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, url: "https://example.com/api/billing/recovery-checkout?t=token" });
    });
});
