import { buildImportedRenderPage } from "./importedRenderPage";

describe("buildImportedRenderPage", () => {
    it("keeps template interpolation in imported HTML as literal data", () => {
        const attackerInput = "<p>${process.env.STRIPE_SECRET_KEY}</p> ` + process.env.FIREBASE_SERVICE_ACCOUNT + `";

        const generatedPage = buildImportedRenderPage(attackerInput);

        expect(generatedPage).toContain(JSON.stringify(attackerInput));
        expect(generatedPage).not.toContain("sk_live_test_secret");
        expect(generatedPage).not.toContain('"type": "service_account"');
    });
});
