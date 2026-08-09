import { buildSupportDocsContext, buildSupportPolicyContext, rankSupportDocs } from "./supportRag";

describe("supportRag", () => {
    const docs = [
        { id: "download", text: "Downloads are not supported in the app.", embedding: [1, 0, 0] },
        { id: "images", text: "Images can be uploaded from the custom tab.", embedding: [0, 1, 0] },
        { id: "billing", text: "Escalations are managed by the internal support team.", embedding: [0, 0, 1] },
    ];

    it("ranks the most relevant docs for a question", () => {
        const ranked = rankSupportDocs("how do i upload images", docs);
        expect(ranked[0]?.id).toBe("images");
        expect(ranked[1]?.id).toBeDefined();
    });

    it("builds a context blob from the top matching docs", () => {
        const context = buildSupportDocsContext("how do i download the app", docs, undefined, 2);
        expect(context).toContain("### download");
        expect(context).toContain("Downloads are not supported");
        expect(context).not.toContain("### billing");
    });

    it("adds the export-code policy snippet for export questions", () => {
        const context = buildSupportPolicyContext("can I export the code from Kloner?");
        expect(context).toContain("code-export-policy");
        expect(context).toContain("does not currently offer code exporting");
    });
});
