export type PreviewFailureErrorClass =
  | "compile_error"
  | "dependency_error"
  | "machine_timeout"
  | "proxy_unreachable"
  | "network_unreachable"
  | "runtime_crash"
  | "app_unreachable"
  | "rate_limited"
  | "preview_replaced_or_deleted"
  | "unknown";

export type PreviewFailureUserAction = "refresh" | "rebuild" | "reconnect" | "wait_and_retry" | "contact_support";

export type PreviewFailureContract = {
  errorClass: PreviewFailureErrorClass;
  aiFixEligible: boolean;
  fixActionType: "quick_fix_compile" | null;
  userAction: PreviewFailureUserAction;
  confidence: number;
  reason: string;
  compileError?: {
    quickFixEligible: boolean;
    summary: string;
    detail: string;
    fingerprint: string;
  };
};

const PREVIEW_FAILURE_ERROR_CLASSES = new Set<PreviewFailureErrorClass>([
  "compile_error",
  "dependency_error",
  "machine_timeout",
  "proxy_unreachable",
  "network_unreachable",
  "runtime_crash",
  "app_unreachable",
  "rate_limited",
  "preview_replaced_or_deleted",
  "unknown",
]);

const PREVIEW_FAILURE_USER_ACTIONS = new Set<PreviewFailureUserAction>([
  "refresh",
  "rebuild",
  "reconnect",
  "wait_and_retry",
  "contact_support",
]);

const AI_FIXABLE_FAILURE_CLASSES = new Set<PreviewFailureErrorClass>([
  "compile_error",
  "dependency_error",
]);

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

export function normalizePreviewFailureContract(rawInput: unknown): PreviewFailureContract | null {
  const rawObject = asRecord(rawInput);
  if (!rawObject) return null;

  const failure = asRecord(rawObject.failure) || rawObject;

  const errorClassRaw = String(failure.errorClass || "").trim().toLowerCase() as PreviewFailureErrorClass;
  if (!PREVIEW_FAILURE_ERROR_CLASSES.has(errorClassRaw)) return null;

  const userActionRaw = String(failure.userAction || "").trim().toLowerCase() as PreviewFailureUserAction;
  const userAction: PreviewFailureUserAction = PREVIEW_FAILURE_USER_ACTIONS.has(userActionRaw) ? userActionRaw : "refresh";

  const aiFixEligible = failure.aiFixEligible === true;
  const fixActionTypeRaw = String(failure.fixActionType || "").trim().toLowerCase();
  const fixActionType: "quick_fix_compile" | null =
    aiFixEligible && fixActionTypeRaw === "quick_fix_compile" ? "quick_fix_compile" : null;

  const confidenceRaw = Number(failure.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
  const reason = String(failure.reason || "").trim();

  const compileErrorRaw = asRecord(failure.compileError);
  const compileError = compileErrorRaw
    ? {
        quickFixEligible: compileErrorRaw.quickFixEligible === true,
        summary: String(compileErrorRaw.summary || "").trim(),
        detail: String(compileErrorRaw.detail || "").trim(),
        fingerprint: String(compileErrorRaw.fingerprint || "").trim(),
      }
    : undefined;

  return {
    errorClass: errorClassRaw,
    aiFixEligible,
    fixActionType,
    userAction,
    confidence,
    reason,
    compileError,
  };
}

export function canShowPreviewFixWithAi(failure: PreviewFailureContract | null | undefined): boolean {
  if (!failure) return false;
  // Forward-compatible policy: dependency_error is allowed only when the backend
  // explicitly marks it AI-fixable and includes quick_fix_compile action typing.
  // Class membership alone is never sufficient to show Fix with AI.
  return (
    AI_FIXABLE_FAILURE_CLASSES.has(failure.errorClass) &&
    failure.aiFixEligible === true &&
    failure.fixActionType === "quick_fix_compile"
  );
}

export function mapPreviewUserActionLabel(userAction: PreviewFailureUserAction | null | undefined): string {
  switch (userAction) {
    case "rebuild":
      return "Generate new preview";
    case "reconnect":
      return "Reconnect";
    case "wait_and_retry":
      return "Retry";
    case "contact_support":
      return "Contact support";
    case "refresh":
    default:
      return "Refresh";
  }
}
