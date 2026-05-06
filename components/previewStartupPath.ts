export type StartupPathSource = "explicit_deep_link" | "default_root" | "stale_state_blocked";

export type ExplicitStartupPathContext = {
  appId: string;
  previewCode: string;
  path: string | null | undefined;
} | null;

export type PreviewStartupPathDecision = {
  initialPath: string;
  source: StartupPathSource;
  explicitInputPath: string | null;
  persistedPathSeen: string | null;
};

export function normalizeStartupPath(input: string | null | undefined): string {
  const raw = String(input || "").trim();
  if (!raw) return "/";

  const withoutQuery = raw.split(/[?#]/)[0] || "/";
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  const normalized = collapsed.replace(/\/+$/g, "") || "/";
  return normalized;
}

function toPreviewBase(previewUrl: string): string {
  if (!previewUrl) return "";

  try {
    const u = new URL(previewUrl, "http://localhost");
    const segs = u.pathname.split("/").filter(Boolean);

    if (segs.length >= 2 && segs[0] === "preview") {
      const base = `/${segs[0]}/${segs[1]}`;
      u.pathname = base;
    }

    return u.toString();
  } catch {
    return previewUrl;
  }
}

export function buildPreviewStartupUrl(previewUrl: string, initialPath: string): string {
  void initialPath;
  return toPreviewBase(String(previewUrl || "").trim());
}

export function shouldSendExplicitStartupNavigate(decision: PreviewStartupPathDecision): boolean {
  return decision.source === "explicit_deep_link" && normalizeStartupPath(decision.initialPath) !== "/";
}

export function decidePreviewStartupPath(params: {
  appId: string;
  previewCode: string;
  explicitContext: ExplicitStartupPathContext;
  persistedPathSeen?: string | null | undefined;
}): PreviewStartupPathDecision {
  const persistedPathSeen = normalizeStartupPath(params.persistedPathSeen);

  const explicitMatchesScope = Boolean(
    params.explicitContext &&
      params.explicitContext.appId === params.appId &&
      params.explicitContext.previewCode === params.previewCode,
  );
  const explicitInputPath = explicitMatchesScope
    ? normalizeStartupPath(params.explicitContext?.path)
    : null;

  if (explicitInputPath && explicitInputPath !== "/") {
    return {
      initialPath: explicitInputPath,
      source: "explicit_deep_link",
      explicitInputPath,
      persistedPathSeen,
    };
  }

  if (persistedPathSeen !== "/") {
    return {
      initialPath: "/",
      source: "stale_state_blocked",
      explicitInputPath,
      persistedPathSeen,
    };
  }

  return {
    initialPath: "/",
    source: "default_root",
    explicitInputPath,
    persistedPathSeen,
  };
}
