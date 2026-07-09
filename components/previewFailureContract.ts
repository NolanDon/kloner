export type PreviewFailureErrorClass =
  | "compile_error"
  | "dependency_error"
  | "white_screen"
  | "machine_timeout"
  | "proxy_unreachable"
  | "network_unreachable"
  | "runtime_crash"
  | "app_unreachable"
  | "rate_limited"
  | "preview_replaced_or_deleted"
  | "unknown";

export type PreviewFailureUserAction = "refresh" | "rebuild" | "reconnect" | "wait_and_retry" | "contact_support";

export type PreviewGenerationStatus = "processing" | "ready" | "warning" | "error";
export type PreviewGenerationRecommendedAction = "wait" | "retry_scan" | "open_builder" | "contact_support" | (string & {});

export type PreviewGenerationContract = {
  status: PreviewGenerationStatus;
  userMessage: string | null;
  message: string | null;
  details: string | null;
  warningCode: string | null;
  errorCode: string | null;
  retryable: boolean;
  retryAction: string | null;
  recommendedAction: PreviewGenerationRecommendedAction | null;
  warnings: unknown[];
  warning: Record<string, any> | null;
  error: Record<string, any> | null;
};

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
    metadata?: {
      requestedAssets?: string[];
      missingAssets?: string[];
      availableAssets?: string[];
    } | null;
  };
};

const PREVIEW_FAILURE_ERROR_CLASSES = new Set<PreviewFailureErrorClass>([
  "compile_error",
  "dependency_error",
  "white_screen",
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
  "white_screen",
]);

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asStringArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice() : [];
}

function getPreviewGenerationStatus(raw: Record<string, any>): PreviewGenerationStatus {
  const status = String(raw.status || raw.state || raw.phase || raw.stage || "").trim().toLowerCase();
  if (status === "processing" || status === "ready" || status === "warning" || status === "error") {
    return status;
  }

  if (raw.errorCode || raw.error || raw.errorMessage) return "error";
  if (raw.warningCode || raw.warning || raw.warningMessage) return "warning";
  return "processing";
}

export function normalizePreviewGenerationContract(rawInput: unknown): PreviewGenerationContract | null {
  const rawObject = asRecord(rawInput);
  if (!rawObject) return null;

  const warning = asRecord(rawObject.warning);
  const error = asRecord(rawObject.error);
  const warnings = asStringArray(rawObject.warnings);

  const status = getPreviewGenerationStatus(rawObject);
  const userMessage =
    asString(rawObject.userMessage) ||
    asString(rawObject.message) ||
    asString(warning?.userMessage) ||
    asString(warning?.message) ||
    asString(error?.userMessage) ||
    asString(error?.message) ||
    null;

  const details =
    asString(rawObject.details) ||
    asString(warning?.details) ||
    asString(error?.details) ||
    null;

  const warningCode =
    asString(rawObject.warningCode) ||
    asString(warning?.code) ||
    asString(warning?.warningCode) ||
    null;

  const errorCode =
    asString(rawObject.errorCode) ||
    asString(error?.code) ||
    asString(error?.errorCode) ||
    null;

  const retryable = rawObject.retryable === true || warning?.retryable === true || error?.retryable === true;
  const retryAction =
    asString(rawObject.retryAction) ||
    asString(warning?.retryAction) ||
    asString(error?.retryAction) ||
    null;
  const recommendedAction =
    asString(rawObject.recommendedAction) ||
    asString(warning?.recommendedAction) ||
    asString(error?.recommendedAction) ||
    (retryAction === "retry_scan" ? "retry_scan" : null);

  return {
    status,
    userMessage,
    message: userMessage || asString(rawObject.message) || null,
    details,
    warningCode,
    errorCode,
    retryable: status === "processing" ? false : retryable,
    retryAction: status === "processing" ? null : retryAction,
    recommendedAction: status === "processing" ? "wait" : recommendedAction,
    warnings,
    warning,
    error,
  };
}

export function mapPreviewRecommendedActionLabel(recommendedAction: PreviewGenerationRecommendedAction | null | undefined): string {
  switch (String(recommendedAction || "").trim().toLowerCase()) {
    case "retry_scan":
      return "Retry";
    case "open_builder":
      return "Open builder";
    case "contact_support":
      return "Contact support";
    case "wait":
      return "Wait";
    default:
      return "Refresh";
  }
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
        metadata: asRecord(compileErrorRaw.metadata)
          ? {
              requestedAssets: Array.isArray(compileErrorRaw.metadata.requestedAssets)
                ? compileErrorRaw.metadata.requestedAssets.map((value) => String(value || "").trim()).filter(Boolean)
                : undefined,
              missingAssets: Array.isArray(compileErrorRaw.metadata.missingAssets)
                ? compileErrorRaw.metadata.missingAssets.map((value) => String(value || "").trim()).filter(Boolean)
                : undefined,
              availableAssets: Array.isArray(compileErrorRaw.metadata.availableAssets)
                ? compileErrorRaw.metadata.availableAssets.map((value) => String(value || "").trim()).filter(Boolean)
                : undefined,
            }
          : null,
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
      return "Start fresh";
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
