import { buildUserFacingNoOpMessage, sanitizeUserFacingAiMessage } from "./route";

describe("sanitizeUserFacingAiMessage", () => {
    it("replaces technical search internals with a plain user-facing fallback", () => {
        const fallback = buildUserFacingNoOpMessage({ currentFile: null, needsMoreContext: false });
        const message = sanitizeUserFacingAiMessage({
            text: "Could not add new footer navigation link. The content of relevant layout files was not provided. Notes: RELEVANT_CHUNKS showed [object Object].",
            fallback,
        });

        expect(message).toBe(fallback);
        expect(message).not.toContain("RELEVANT_CHUNKS");
        expect(message).not.toContain("[object Object]");
        expect(message).not.toContain("layout files");
    });

    it("keeps a normal short response intact", () => {
        const fallback = buildUserFacingNoOpMessage({ currentFile: "app/page.tsx", needsMoreContext: false });
        const message = sanitizeUserFacingAiMessage({
            text: "I added the link to the footer.",
            fallback,
        });

        expect(message).toBe("I added the link to the footer.");
    });
});
