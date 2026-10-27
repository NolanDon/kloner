import { detectAgentLanguage, languagePreferenceAnswer, normalizeAgentLanguage } from "./agentLanguage";

describe("agent language preference", () => {
    it("detects Korean messages including a URL with Korean text", () => {
        expect(detectAgentLanguage("여기처럼 만들어 주세요")).toBe("ko");
        expect(detectAgentLanguage("https://oakville.kr 여기처럼 만들어 주세요")).toBe("ko");
        expect(detectAgentLanguage("Make this green")).toBeNull();
    });

    it("accepts localized yes/no and validates stored preference", () => {
        expect(languagePreferenceAnswer("네")).toBe("yes");
        expect(languagePreferenceAnswer("네, 한국어로 해주세요")).toBe("yes");
        expect(languagePreferenceAnswer("아니요")).toBe("no");
        expect(normalizeAgentLanguage("ko")).toBe("ko");
        expect(normalizeAgentLanguage("korean")).toBeNull();
    });
});
