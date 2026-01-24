// src/lib/apps.test.ts

describe("apps.ts CSRF", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        global.fetch = originalFetch as any;
        jest.restoreAllMocks();
    });

    it("includes x-csrf when archiving", async () => {
        const calls: any[] = [];

        global.fetch = (async (input: any, init?: any) => {
            calls.push([input, init]);

            if (String(input) === "/api/auth/csrf") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ csrf: "token_1" }),
                } as any;
            }

            if (String(input).includes("/api/app-builder/") && String(input).endsWith("/archive")) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => "",
                } as any;
            }

            throw new Error("unexpected fetch: " + String(input));
        }) as any;

        const { archiveApp } = await import("./apps");
        await archiveApp("app_1");

        const archiveCall = calls.find((c) => String(c[0]).includes("/api/app-builder/") && String(c[0]).endsWith("/archive"));
        expect(archiveCall).toBeTruthy();
        expect(archiveCall[1]?.headers?.["x-csrf"]).toBe("token_1");
    });

    it("retries once on CSRF 403", async () => {
        let csrfCounter = 0;
        let archiveCounter = 0;

        global.fetch = (async (input: any, init?: any) => {
            if (String(input) === "/api/auth/csrf") {
                csrfCounter += 1;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ csrf: `token_${csrfCounter}` }),
                } as any;
            }

            if (String(input).includes("/api/app-builder/") && String(input).endsWith("/archive")) {
                archiveCounter += 1;

                if (archiveCounter === 1) {
                    return {
                        ok: false,
                        status: 403,
                        text: async () => "CSRF check failed",
                    } as any;
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => "",
                } as any;
            }

            throw new Error("unexpected fetch: " + String(input));
        }) as any;

        const { archiveApp } = await import("./apps");
        await archiveApp("app_1");

        expect(csrfCounter).toBe(2);
        expect(archiveCounter).toBe(2);
    });
});
