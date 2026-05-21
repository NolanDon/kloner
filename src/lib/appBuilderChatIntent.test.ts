import { classifyAppBuilderChatIntent, resolveAppBuilderChatRoute } from "./appBuilderChatIntent";

describe("classifyAppBuilderChatIntent", () => {
    const askPrompts = [
        "how do i add an image",
        "how do i upload images",
        "how do i download the app",
        "how do i publish this",
        "how do i preview the site",
        "where do I change the logo",
        "what is the custom tab for",
        "can you explain how billing works",
    ];

    const taskPrompts = [
        "update the navbar",
        "fix the footer in components/Footer.tsx",
        "change the hero copy on the home page",
        "add an image upload button to the custom tab",
        "remove the old banner from app/page.tsx",
        "make the layout responsive",
        "edit the route for the contact page",
        "refactor the dashboard cards",
    ];

    it("routes a broad set of plain questions to the quick-answer lane", () => {
        for (let i = 0; i < 15; i++) {
            for (const prompt of askPrompts) {
                const question = i % 2 === 0 ? prompt : `${prompt} please`;
                expect(classifyAppBuilderChatIntent(question)).toMatchObject({ kind: "quick-question" });
                expect(resolveAppBuilderChatRoute({ mode: "auto", message: question }).route).toBe("ask");
            }
        }
    });

    it("routes a broad set of edit requests to the task lane", () => {
        for (let i = 0; i < 15; i++) {
            for (const prompt of taskPrompts) {
                const request = i % 2 === 0 ? prompt : `${prompt} in app/page.tsx`;
                expect(classifyAppBuilderChatIntent(request)).toMatchObject({ kind: "edit-request" });
                expect(resolveAppBuilderChatRoute({ mode: "auto", message: request }).route).toBe("task");
            }
        }
    });

    it("honors explicit mode overrides even when the classifier disagrees", () => {
        expect(resolveAppBuilderChatRoute({ mode: "ask", message: "update the navbar" }).route).toBe("ask");
        expect(resolveAppBuilderChatRoute({ mode: "task", message: "how do i upload images" }).route).toBe("task");
    });
});