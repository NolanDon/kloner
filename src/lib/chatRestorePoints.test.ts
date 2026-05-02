import {
  buildMissingApplyContractUserMessage,
  buildChatRestorePointRevertSuccessMessage,
  buildChatRestorePointsErrorMessage,
  buildRestorePointEndpointAuditPrompt,
  getLatestChatRestorePoint,
  getPreferredOrLatestChatRestorePoint,
  isRestorePointListEndpointMissing,
  normalizeChatRestorePoints,
} from "./chatRestorePoints";

describe("chatRestorePoints", () => {
  test("normalizes and sorts restore points descending by createdAt", () => {
    const normalized = normalizeChatRestorePoints({
      restorePoints: [
        {
          restorePointId: " rp-1 ",
          requestId: " req-1 ",
          reason: " first ",
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:01:00.000Z",
          fileCount: 3,
          touchedPaths: [" public/index.html ", ""],
          skippedPaths: [" app.js "],
          restorable: true,
        },
        {
          restorePointId: "rp-2",
          requestId: "req-2",
          reason: "second",
          createdAt: "2026-05-02T10:00:00.000Z",
          fileCount: 1,
          touchedPaths: ["styles.css"],
          skippedPaths: [],
          restorable: false,
        },
        {
          restorePointId: "",
          requestId: "req-3",
          createdAt: "2026-05-03T10:00:00.000Z",
        },
      ],
    });

    expect(normalized).toHaveLength(2);
    expect(normalized[0].restorePointId).toBe("rp-2");
    expect(normalized[1].restorePointId).toBe("rp-1");
    expect(normalized[1].requestId).toBe("req-1");
    expect(normalized[1].reason).toBe("first");
    expect(normalized[1].touchedPaths).toEqual(["public/index.html"]);
    expect(normalized[1].skippedPaths).toEqual(["app.js"]);
  });

  test("defaults restorable true and clamps invalid file counts", () => {
    const normalized = normalizeChatRestorePoints({
      restorePoints: [
        { restorePointId: "rp-a", fileCount: -5 },
        { restorePointId: "rp-b", fileCount: "NaN" },
      ],
    });

    expect(normalized[0].restorable).toBe(true);
    expect(normalized[0].fileCount).toBe(0);
    expect(normalized[1].fileCount).toBe(0);
  });

  test("normalizes backend id/timestamp/label payload shape", () => {
    const normalized = normalizeChatRestorePoints({
      ok: true,
      restorePoints: [
        {
          id: "SrheKplKEB7mobbHp69S",
          createdAt: { _seconds: 1777670719, _nanoseconds: 662000000 },
          label: "Added a Learn More button",
          source: "manual",
          kept: false,
          paths: ["public/index.html"],
          undoOf: null,
        },
      ],
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0].restorePointId).toBe("SrheKplKEB7mobbHp69S");
    expect(normalized[0].reason).toBe("Added a Learn More button");
    expect(normalized[0].touchedPaths).toEqual(["public/index.html"]);
    expect(normalized[0].fileCount).toBe(1);
    expect(normalized[0].createdAt).toMatch(/T/);
  });

  test("maps auth and not-found error messages", () => {
    expect(buildChatRestorePointsErrorMessage({ status: 401 })).toBe(
      "Session expired. Please sign in again.",
    );

    expect(
      buildChatRestorePointsErrorMessage({
        status: 404,
        code: "RESTORE_POINT_NOT_FOUND",
      }),
    ).toBe("Restore point is no longer available. Please refresh the list.");
  });

  test("maps non-restorable and server errors with request id", () => {
    expect(
      buildChatRestorePointsErrorMessage({
        status: 409,
        code: "RESTORE_POINT_NOT_RESTORABLE",
      }),
    ).toBe("That restore point cannot be reverted due to snapshot limits.");

    expect(
      buildChatRestorePointsErrorMessage({
        status: 502,
        requestId: "req-502",
      }),
    ).toBe("Restore point request failed. Please retry. Request ID: req-502");
  });

  test("builds revert success message and includes restart guidance edge case", () => {
    const message = buildChatRestorePointRevertSuccessMessage({
      restorePointId: "abcdef123456",
      restoredFiles: 2,
      wrote: 1,
      deleted: 1,
      requiresRestart: true,
      requestId: "req-1",
    });

    expect(message).toContain("Restore point abcdef12 was reverted.");
    expect(message).toContain("Restored files: 2. Wrote: 1. Deleted: 1.");
    expect(message).toContain("Changes may not be visible yet.");
    expect(message).toContain("Request ID: req-1");
  });

  test("returns latest restore point or null", () => {
    const normalized = normalizeChatRestorePoints({
      restorePoints: [
        { restorePointId: "rp-old", createdAt: "2026-05-01T00:00:00.000Z" },
        { restorePointId: "rp-new", createdAt: "2026-05-02T00:00:00.000Z" },
      ],
    });

    expect(getLatestChatRestorePoint(normalized)?.restorePointId).toBe("rp-new");
    expect(getLatestChatRestorePoint([])).toBeNull();
    expect(getLatestChatRestorePoint(null)).toBeNull();
  });

  test("returns preferred restore point when available, otherwise latest", () => {
    const normalized = normalizeChatRestorePoints({
      restorePoints: [
        { restorePointId: "rp-1", createdAt: "2026-05-01T00:00:00.000Z" },
        { restorePointId: "rp-2", createdAt: "2026-05-02T00:00:00.000Z" },
      ],
    });

    expect(getPreferredOrLatestChatRestorePoint(normalized, "rp-1")?.restorePointId).toBe("rp-1");
    expect(getPreferredOrLatestChatRestorePoint(normalized, "missing")?.restorePointId).toBe("rp-2");
    expect(getPreferredOrLatestChatRestorePoint([], "rp-1")).toBeNull();
  });

  test("detects missing list endpoint vs missing restore point", () => {
    expect(isRestorePointListEndpointMissing({ status: 404, code: null })).toBe(true);
    expect(isRestorePointListEndpointMissing({ status: 404, code: "RESTORE_POINT_NOT_FOUND" })).toBe(false);
    expect(isRestorePointListEndpointMissing({ status: 500, code: null })).toBe(false);
  });

  test("builds backend audit prompt with endpoint and expected shape", () => {
    const prompt = buildRestorePointEndpointAuditPrompt({
      endpoint: "/api/v1/app-embeddings/restore-points",
      appId: "app-1",
      status: 404,
      requestId: "req-404",
      expectedResponseShape: {
        ok: true,
        restorePoints: [
          {
            restorePointId: "string",
            requestId: "string",
          },
        ],
      },
    });

    expect(prompt).toContain("Backend audit request (restore point endpoint)");
    expect(prompt).toContain("/api/v1/app-embeddings/restore-points");
    expect(prompt).toContain("\"status\": 404");
    expect(prompt).toContain("restorePoints");
  });

  test("builds concise contract-missing user message based on restore-point availability", () => {
    const successMessage = buildMissingApplyContractUserMessage({
      restorePointCardVisible: true,
      hasLatestRestorePoint: true,
    });
    expect(successMessage).toContain("restore point above");
    expect(successMessage).toContain("undo");

    const fallbackMessage = buildMissingApplyContractUserMessage({
      restorePointCardVisible: false,
      hasLatestRestorePoint: false,
    });
    expect(fallbackMessage).toContain("couldn’t load the latest restore point yet");
    expect(fallbackMessage).toContain("tap Refresh once");
  });
});
