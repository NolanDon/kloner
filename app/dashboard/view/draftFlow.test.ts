import { normalizeDashboardDraftRecord, normalizeDashboardDraftRecords, submitDashboardUrlDraft } from "./draftFlow";

describe("dashboard draft flow", () => {
    it("normalizes draft API payloads into newest-first dashboard records", () => {
        const records = normalizeDashboardDraftRecords([
            {
                draftId: "draft-old",
                id: "draft-old",
                name: "Old Draft",
                createdAt: 100,
                sourceUrl: "https://old.example.com",
            },
            {
                draftId: "draft-new",
                id: "draft-new",
                name: "New Draft",
                createdAt: 200,
                sourceUrl: "https://new.example.com",
                completed: false,
                warnings: [],
            },
        ]);

        expect(records).toHaveLength(2);
        expect(records[0]?.draftId).toBe("draft-new");
        expect(records[0]?.pendingCompleted).toBe(true);
        expect(records[1]?.draftId).toBe("draft-old");
    });

    it("derives a display name from the source url when the draft payload has no name", () => {
        const record = normalizeDashboardDraftRecord({
            draftId: "draft-1",
            id: "draft-1",
            sourceUrl: "https://www.example.com/blog",
            createdAt: 1,
        });

        expect(record?.name).toBe("example.com");
    });

    it("submits a url, clears the pending url after /generate resolves, and persists a draft record", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1234567890);
        jest.spyOn(Math, "random")
            .mockReturnValueOnce(0.123456)
            .mockReturnValueOnce(0.987654);

        const state = {
            pendingUrl: null as string | null,
            drafts: [] as any[],
            pendingDrafts: {} as Record<string, boolean>,
            err: "",
            info: "",
            paywall: null as "screenshot" | null,
        };
        const calls: Array<[string, any?]> = [];
        const push = jest.fn();

        const fetchImpl = jest.fn(async (input: any, init?: any) => {
            calls.push([String(input), init]);

            if (String(input) === "/api/private/generate") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true }),
                } as any;
            }

            if (String(input) === "/api/private/kloner-draft") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true }),
                } as any;
            }

            throw new Error(`unexpected fetch: ${String(input)}`);
        });

        const ok = await submitDashboardUrlDraft({
            rawUrl: "example.com",
            canUseScreenshotCredit: () => true,
            fetchImpl: fetchImpl as any,
            push,
            setErr: (value) => {
                state.err = value;
            },
            setInfo: (value) => {
                state.info = value;
            },
            setShowCreditsPaywall: (mode) => {
                state.paywall = mode;
            },
            setWebsiteSubmissionPendingUrl: (next) => {
                state.pendingUrl = typeof next === "function" ? next(state.pendingUrl) : next;
            },
            setDraftApps: (next) => {
                state.drafts = typeof next === "function" ? next(state.drafts) : next;
            },
            setPendingDraftApps: (next) => {
                state.pendingDrafts = typeof next === "function" ? next(state.pendingDrafts) : next;
            },
        });

        expect(ok).toBe(true);
        expect(state.pendingUrl).toBeNull();
        expect(state.err).toBe("");
        expect(state.info).toBe("");
        expect(state.paywall).toBeNull();
        expect(state.drafts).toHaveLength(1);
        expect(state.pendingDrafts).toEqual({});
        expect(calls.map(([url]) => url)).toEqual(["/api/private/generate", "/api/private/kloner-draft"]);

        const draftRequest = calls[1]?.[1];
        const draftBody = JSON.parse(draftRequest.body);
        expect(draftBody.action).toBe("upsert");
        expect(draftBody.draft.sourceUrl).toBe("https://example.com/");
        expect(draftBody.draft.completed).toBe(true);

        jest.restoreAllMocks();
    });
});
