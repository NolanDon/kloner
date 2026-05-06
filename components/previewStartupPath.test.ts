import {
  buildPreviewStartupUrl,
  decidePreviewStartupPath,
  shouldSendExplicitStartupNavigate,
} from "./previewStartupPath";

describe("preview startup path selection", () => {
  it("new preview code with stale persisted /blog starts at /", () => {
    const decision = decidePreviewStartupPath({
      appId: "app-1",
      previewCode: "code-1",
      explicitContext: null,
      persistedPathSeen: "/blog",
    });

    expect(decision.initialPath).toBe("/");
    expect(decision.source).toBe("stale_state_blocked");

    const url = buildPreviewStartupUrl("https://hub.example.com/preview/code-1?t=abc", decision.initialPath);
    expect(url).toBe("https://hub.example.com/preview/code-1?t=abc");
  });

  it("explicit deep-link open to /blog is honored", () => {
    const decision = decidePreviewStartupPath({
      appId: "app-1",
      previewCode: "code-1",
      explicitContext: { appId: "app-1", previewCode: "code-1", path: "/blog" },
      persistedPathSeen: "/",
    });

    expect(decision.initialPath).toBe("/blog");
    expect(decision.source).toBe("explicit_deep_link");
    expect(shouldSendExplicitStartupNavigate(decision)).toBe(true);

    const url = buildPreviewStartupUrl("https://hub.example.com/preview/code-1?t=abc", decision.initialPath);
    expect(url).toBe("https://hub.example.com/preview/code-1?t=abc");
  });

  it("switching appId resets default path to / when explicit scope mismatches", () => {
    const decision = decidePreviewStartupPath({
      appId: "app-2",
      previewCode: "code-1",
      explicitContext: { appId: "app-1", previewCode: "code-1", path: "/blog" },
      persistedPathSeen: "/",
    });

    expect(decision.initialPath).toBe("/");
    expect(decision.source).toBe("default_root");
  });

  it("reopen/reconnect without explicit path starts at /", () => {
    const decision = decidePreviewStartupPath({
      appId: "app-1",
      previewCode: "code-2",
      explicitContext: null,
      persistedPathSeen: null,
    });

    expect(decision.initialPath).toBe("/");
    expect(decision.source).toBe("default_root");
  });

  it("startup URL does not include /blog unless explicit deep-link is scoped", () => {
    const blockedDecision = decidePreviewStartupPath({
      appId: "app-1",
      previewCode: "code-9",
      explicitContext: { appId: "app-1", previewCode: "code-8", path: "/blog" },
      persistedPathSeen: "/blog",
    });
    const blockedUrl = buildPreviewStartupUrl("https://hub.example.com/preview/code-9?t=abc", blockedDecision.initialPath);

    expect(blockedDecision.source).toBe("stale_state_blocked");
    expect(blockedUrl).toBe("https://hub.example.com/preview/code-9?t=abc");

    const explicitDecision = decidePreviewStartupPath({
      appId: "app-1",
      previewCode: "code-9",
      explicitContext: { appId: "app-1", previewCode: "code-9", path: "/blog" },
      persistedPathSeen: "/",
    });
    const explicitUrl = buildPreviewStartupUrl("https://hub.example.com/preview/code-9?t=abc", explicitDecision.initialPath);

    expect(explicitDecision.source).toBe("explicit_deep_link");
    expect(shouldSendExplicitStartupNavigate(explicitDecision)).toBe(true);
    expect(explicitUrl).toBe("https://hub.example.com/preview/code-9?t=abc");
  });
});
