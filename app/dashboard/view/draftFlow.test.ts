import {
    buildTimedOutDraftIssueState,
    isPersistedDraftPendingState,
    isTimedOutDraftLoadingState,
    normalizeDashboardDraftRecord,
    normalizeDashboardDraftRecords,
    resolveDashboardDraftThumbnailUrl,
    shouldSuppressCompletedDraftIssue,
    shouldDisableDraftDeleteButton,
    submitDashboardUrlDraft,
} from "./draftFlow";

describe("dashboard draft flow", () => {
    it("keeps draft delete enabled during pending or locked states when not deleting", () => {
        expect(
            shouldDisableDraftDeleteButton({
                isDeleting: false,
                isPendingCreation: true,
                disableActions: true,
                accessLocked: true,
            }),
        ).toBe(false);

        expect(
            shouldDisableDraftDeleteButton({
                isDeleting: false,
                isPendingCreation: false,
                disableActions: false,
                accessLocked: false,
            }),
        ).toBe(false);
    });

    it("disables draft delete only while delete request is in flight", () => {
        expect(
            shouldDisableDraftDeleteButton({
                isDeleting: true,
                isPendingCreation: false,
            }),
        ).toBe(true);

        expect(
            shouldDisableDraftDeleteButton({
                isDeleting: true,
                isPendingCreation: true,
                disableActions: true,
            }),
        ).toBe(true);
    });

    it("only marks persisted pending state for actual draft cards", () => {
        expect(
            isPersistedDraftPendingState({
                isDraftCard: false,
                status: "queued",
                archiveZipPath: null,
                archiveZipUrl: null,
            }),
        ).toBe(false);

        expect(
            isPersistedDraftPendingState({
                isDraftCard: true,
                status: "queued",
                archiveZipPath: null,
                archiveZipUrl: null,
            }),
        ).toBe(true);
    });

    it("clears draft pending persistence when archive is ready", () => {
        expect(
            isPersistedDraftPendingState({
                isDraftCard: true,
                status: "ready",
                archiveZipPath: "archives/draft.zip",
                archiveZipUrl: null,
            }),
        ).toBe(false);

        expect(
            isPersistedDraftPendingState({
                isDraftCard: true,
                status: "warning",
                archiveZipPath: null,
                archiveZipUrl: "https://cdn.example.com/archive.zip",
            }),
        ).toBe(false);
    });

    it("keeps a fresh draft loader active before the timeout window elapses", () => {
        const now = 1_000_000;
        expect(
            isTimedOutDraftLoadingState({
                status: "processing",
                createdAt: now - (5 * 60 * 1000),
                updatedAt: now - (5 * 60 * 1000),
            }, now),
        ).toBe(false);
    });

    it("times out a draft loader once it has been stuck long enough", () => {
        const now = 1_000_000;
        expect(
            isTimedOutDraftLoadingState({
                status: "processing",
                createdAt: now - (10 * 60 * 1000) - 1,
                updatedAt: now - (10 * 60 * 1000) - 1,
            }, now),
        ).toBe(true);
        expect(buildTimedOutDraftIssueState()).toMatchObject({
            code: "DRAFT_SCAN_TIMEOUT",
            blocked: false,
            retryable: false,
        });
    });

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
        expect(records[0]?.pendingCompleted).toBe(false);
        expect(records[1]?.draftId).toBe("draft-old");
    });

    it("derives a display name from the source url when the draft payload has no name", () => {
        const record = normalizeDashboardDraftRecord({
            draftId: "draft-1",
            id: "draft-1",
            sourceUrl: "https://www.example.com/blog",
            createdAt: 1,
        });

        expect(record?.name).toBe("Draft: example.com");
    });

    it("prefers the first signed screenshot url when one exists on the draft details", () => {
        const thumbnail = resolveDashboardDraftThumbnailUrl({
            sourceUrl: "https://example.com",
            details: {
                trackedUrl: {
                    screenshots: [
                        {
                            url: "https://cdn.example.com/signed-shot.jpg",
                        },
                    ],
                },
            },
        });

        expect(thumbnail).toBe("https://cdn.example.com/signed-shot.jpg");
    });

    it("falls back to a backend-resolved source url lookup and ignores key-only screenshot entries", () => {
        const thumbnail = resolveDashboardDraftThumbnailUrl(
            {
                sourceUrl: "https://example.com",
                details: {
                    trackedUrl: {
                        screenshots: [
                            {
                                key: "kloner-screenshots/user/hash/shot.jpg",
                            },
                        ],
                    },
                },
            },
            new Map([
                ["https://example.com/", "https://cdn.example.com/lookup-shot.jpg"],
            ]),
        );

        expect(thumbnail).toBe("https://cdn.example.com/lookup-shot.jpg");
    });

    it("suppresses non-blocking draft issues once the archive is ready", () => {
        expect(
            shouldSuppressCompletedDraftIssue(
                {
                    draftId: "draft-ready",
                    completed: true,
                    pendingCompleted: true,
                    status: "ready",
                    archiveZipPath: "archives/ready.zip",
                    warningCode: "SCAN_INFO",
                    warningMessage: "New wget store saved successfully.",
                },
                {
                    blocked: false,
                    retryable: false,
                    code: "SCAN_INFO",
                    message: "New wget store saved successfully.",
                    details: "archivedDomain=eventsbyencore.ca",
                    action: null,
                },
            ),
        ).toBe(true);
    });

    it("keeps real blocking draft issues visible", () => {
        expect(
            shouldSuppressCompletedDraftIssue(
                {
                    draftId: "draft-blocked",
                    completed: true,
                    pendingCompleted: true,
                    status: "warning",
                    archiveZipPath: "archives/blocked.zip",
                    warningCode: "BLOCKED_URL",
                    warningMessage: "Domain blocked for site cloning",
                },
                {
                    blocked: true,
                    retryable: false,
                    code: "BLOCKED_URL",
                    message: "Domain blocked for site cloning",
                    details: "This URL is blocked",
                    action: "Rescan",
                },
            ),
        ).toBe(false);
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

    it("keeps the optimistic draft visible and persists scan issue details when /generate fails", async () => {
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
                    ok: false,
                    status: 502,
                    json: async () => ({
                        error: "Backend fetch failed",
                        code: "PROXY_FAILURE",
                        details: { reason: "upstream timeout" },
                    }),
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

        expect(ok).toBe(false);
        expect(state.pendingUrl).toBeNull();
        expect(state.err).toContain("Backend fetch failed");
        expect(state.drafts).toHaveLength(1);
        expect(state.drafts[0]?.completed).toBe(false);
        expect(state.drafts[0]?.warningCode).toBe("PROXY_FAILURE");
        expect(state.drafts[0]?.errorCode).toBe("PROXY_FAILURE");
        expect(state.drafts[0]?.retryable).toBe(true);
        expect(state.pendingDrafts).toEqual({});
        expect(calls.map(([url]) => url)).toEqual(["/api/private/generate", "/api/private/kloner-draft"]);

        const draftRequest = calls[1]?.[1];
        const draftBody = JSON.parse(draftRequest.body);
        expect(draftBody.draft.completed).toBe(false);
        expect(draftBody.draft.warningCode).toBe("PROXY_FAILURE");
        expect(draftBody.draft.details).toEqual({ reason: "upstream timeout" });

        jest.restoreAllMocks();
    });
});
