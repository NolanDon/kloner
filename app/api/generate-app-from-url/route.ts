// app/api/generate-app-from-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { callBackend } from "@/src/lib/callBackend";
import { getAuthoritativeUserTier } from "../_lib/userTier";
import { getAdminDb, verifySession } from "../_lib/auth";
import type { UserTier } from "@/src/lib/credits";
import { peekUserCredit, consumeUserCredit } from "../_lib/credits-server";
import { validateAndNormalizePublicHttpUrl, getPublicHttpUrlRejectionReason } from "@/src/lib/publicHttpUrl";
import { captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backendConfigHint() {
  const origin = process.env.BACKEND_ORIGIN || process.env.BACKEND_URL || process.env.PUBLIC_ORIGIN || "";
  const prefix = process.env.BACKEND_PREFIX || "/api/v1";
  const hasInternalKey = Boolean(process.env.INTERNAL_API_KEY);
  return { origin, prefix, hasInternalKey };
}

async function reportBlockedUrlAttempt(args: { uid: string; url: string; reason: string }) {
  const webhookUrl = (process.env.MALICIOUS_ACTIVITY_WEBHOOK_URL || process.env.ABUSE_WEBHOOK_URL || "").trim();
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "blocked_url_attempt",
        uid: args.uid,
        url: args.url,
        reason: args.reason,
        route: "/api/generate-app-from-url",
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Best-effort reporting only.
  }
}

function isBackendFetchFailed(resp: any) {
  return resp?.status === 502 && String(resp?.json?.error || "") === "Backend fetch failed";
}

function detectBrowserName(userAgent: string): string {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "Opera";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("chrome/") && !ua.includes("edg/") && !ua.includes("opr/")) return "Chrome";
  if (ua.includes("safari/") && !ua.includes("chrome/") && !ua.includes("chromium/")) return "Safari";
  return "Other";
}

async function reportZipGenerationFailure(args: {
  req: NextRequest;
  uid: string;
  url: string;
  name: string;
  reason: string;
  statusCode: number;
  reqId?: string;
  backendUrl?: string;
  backendStatus?: number;
  backendMessage?: string;
  appId?: string | null;
}) {
  const userAgent = args.req.headers.get("user-agent") || "";
  const origin = args.req.headers.get("origin") || "";
  const referer = args.req.headers.get("referer") || "";
  const ip =
    args.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    args.req.headers.get("x-real-ip") ||
    "";

  await captureCriticalEvent({
    source: "internal",
    severity: "error",
    route: "/api/generate-app-from-url",
    method: args.req.method,
    statusCode: args.statusCode,
    userId: args.uid,
    requestId: args.reqId,
    url: args.url,
    message: `Zip generation failed: ${args.reason}`,
    errorName: "ZipGenerationFailure",
    service: "generate-app-from-url",
    extra: {
      requestContext: {
        userAgent,
        browser: detectBrowserName(userAgent),
        origin,
        referer,
        ip,
      },
      appName: args.name,
      appId: args.appId || null,
      backend: {
        url: args.backendUrl || null,
        statusCode: args.backendStatus ?? null,
        message: args.backendMessage || null,
      },
      reason: args.reason,
    },
  });
}

export async function POST(req: NextRequest) {
  return requireSessionAndMaybeCsrf(req, async ({ req }) => {
    let decoded: any;
    try {
      decoded = await verifySession(req);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { url, name } = body;
    const requestedAppId = typeof body?.appId === "string" && body.appId.trim() ? body.appId.trim() : "";
    const generationType =
      body?.generationType === "html" || body?.generationFormat === "html"
        ? "html"
        : "nextjs";

    if (!url || typeof url !== "string") {
      await reportZipGenerationFailure({
        req,
        uid: decoded.uid,
        url: typeof url === "string" ? url : "",
        name: typeof name === "string" ? name : "",
        reason: "missing_url",
        statusCode: 400,
      }).catch(() => null);
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    if (!name || typeof name !== "string") {
      await reportZipGenerationFailure({
        req,
        uid: decoded.uid,
        url,
        name: typeof name === "string" ? name : "",
        reason: "missing_name",
        statusCode: 400,
      }).catch(() => null);
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const normalizedUrl = validateAndNormalizePublicHttpUrl(url);
    if (!normalizedUrl) {
      const reason = getPublicHttpUrlRejectionReason(url) || "Invalid URL";
      void reportBlockedUrlAttempt({ uid: decoded.uid, url, reason });
      await reportZipGenerationFailure({
        req,
        uid: decoded.uid,
        url,
        name,
        reason: "blocked_url",
        statusCode: 400,
      }).catch(() => null);
      return NextResponse.json(
        {
          error: reason,
          code: "BLOCKED_URL",
        },
        { status: 400 }
      );
    }

    let tier: UserTier;
    try {
      tier = await getAuthoritativeUserTier(decoded.uid);
    } catch (e: any) {
      await reportZipGenerationFailure({
        req,
        uid: decoded.uid,
        url: normalizedUrl,
        name,
        reason: "tier_lookup_failed",
        statusCode: 500,
        backendMessage: e?.message || "Unable to determine subscription tier. Try again shortly.",
      }).catch(() => null);
      return NextResponse.json(
        {
          error: e?.message || "Unable to determine subscription tier. Try again shortly.",
        },
        { status: 500 }
      );
    }


    // Hard gate: app generation with createPreview consumes preview credits.
    try {
      const peek = await peekUserCredit(decoded.uid, tier, "preview");
      if (!peek.ok || (peek.remaining !== null && peek.remaining <= 0)) {
        await reportZipGenerationFailure({
          req,
          uid: decoded.uid,
          url: normalizedUrl,
          name,
          reason: "preview_credits_exhausted",
          statusCode: 429,
          backendMessage: `Remaining preview credits: ${peek.remaining ?? "unknown"}`,
        }).catch(() => null);
        return NextResponse.json(
          {
            error: "Monthly preview limit reached for your plan.",
            code: "PREVIEW_CREDITS_EXHAUSTED",
            reason: "preview_credits_exhausted",
            remaining: peek.remaining,
            kind: "preview",
          },
          { status: 429 }
        );
      }
    } catch {
      await reportZipGenerationFailure({
        req,
        uid: decoded.uid,
        url: normalizedUrl,
        name,
        reason: "preview_credit_check_failed",
        statusCode: 503,
      }).catch(() => null);
      return NextResponse.json(
        { error: "Unable to check preview credits. Try again shortly." },
        { status: 503 }
      );
    }

    try {
      const appResponse = await callBackend(req, {
        path: "/generate-app-from-url",
        method: "POST",
        body: {
          url: normalizedUrl,
          name,
            appId: requestedAppId || undefined,
          createPreview: true,
          generationType,
          generationFormat: generationType,
        },
        userCtx: { uid: decoded.uid, email: decoded?.email || "", tier },
        timeoutMs: 300000, // 5 minutes
        acceptOnTimeout: true,
      });

      if (isBackendFetchFailed(appResponse)) {
        const hint = backendConfigHint();
        await reportZipGenerationFailure({
          req,
          uid: decoded.uid,
          url: normalizedUrl,
          name,
          reason: "backend_unreachable",
          statusCode: 502,
          reqId: appResponse.reqId,
          backendUrl: appResponse.url,
          backendStatus: appResponse.status,
          backendMessage: "Backend fetch failed",
        }).catch(() => null);
        return NextResponse.json(
          {
            error:
              process.env.NODE_ENV !== "production"
                ? `Failed to reach the backend generation service at ${appResponse.url}. Check BACKEND_URL/BACKEND_ORIGIN and INTERNAL_API_KEY. Also try /api/internal/env-check.`
                : "Failed to reach the backend generation service.",
            code: "BACKEND_UNREACHABLE",
            reqId: appResponse.reqId,
            ...(process.env.NODE_ENV !== "production"
              ? {
                  debug: {
                    attemptedUrl: appResponse.url,
                    env: {
                      BACKEND_ORIGIN: hint.origin || null,
                      BACKEND_PREFIX: hint.prefix,
                      INTERNAL_API_KEY_SET: hint.hasInternalKey,
                    },
                  },
                }
              : {}),
          },
          { status: 502 },
        );
      }

      // Treat any 2xx as a successful "job accepted".
      if (appResponse.status >= 200 && appResponse.status < 300) {
        const appData = (appResponse.json || {}) as any;
        const acceptedAppId = typeof appData.appId === "string" ? appData.appId.trim() : requestedAppId;
        const acceptedJobId = typeof appData.jobId === "string" ? appData.jobId.trim() : "";
        const isTerminalFailure =
          appData?.accepted === false ||
          appData?.code === "ARCHIVE_ZIP_MISSING" ||
          appData?.code === "gemini_input_too_large" ||
          appData?.details?.stage === "archive_preflight";

        if (isTerminalFailure || !acceptedAppId || !acceptedJobId) {
          const message =
            typeof appData?.error === "string" && appData.error.trim()
              ? appData.error.trim()
              : typeof appData?.message === "string" && appData.message.trim()
                ? appData.message.trim()
                : !acceptedJobId
                  ? "App generation started without a job id."
                  : "App generation could not be started.";

          await reportZipGenerationFailure({
            req,
            uid: decoded.uid,
            url: normalizedUrl,
            name,
            reason: isTerminalFailure ? "backend_terminal_failure" : "missing_job_id",
            statusCode: isTerminalFailure ? 409 : 502,
            reqId: appResponse.reqId,
            backendUrl: appResponse.url,
            backendStatus: appResponse.status,
            backendMessage: message,
            appId: acceptedAppId || null,
          }).catch(() => null);

          return NextResponse.json(
            {
              error: message,
              code: appData?.code || (isTerminalFailure ? "ARCHIVE_ZIP_MISSING" : "INVALID_ACCEPTED_RESPONSE"),
              reqId: appResponse.reqId,
              upstreamStatus: appResponse.status,
              ...(typeof appData?.details === "object" && appData.details ? { details: appData.details } : {}),
            },
            { status: appData?.code === "gemini_input_too_large" ? 413 : isTerminalFailure ? 409 : 502 },
          );
        }

        // Charge one preview credit when generation is accepted with an appId.
        if (acceptedAppId && acceptedJobId) {
          try {
            await consumeUserCredit(decoded.uid, tier, "preview");
          } catch (err: any) {
            console.warn("consumeUserCredit failed (preview, generate-app-from-url)", {
              uid: decoded.uid,
              err: err?.message || String(err),
            });
          }
        }

        try {
          const db = getAdminDb();
          const appRef = db.collection("kloner_users").doc(decoded.uid).collection("kloner_apps").doc(acceptedAppId);
          const existingApp = await appRef.get();
          const now = new Date();
          const existingData = existingApp.exists ? (existingApp.data() || {}) as any : null;

          await appRef.set({
            id: acceptedAppId,
            userId: decoded.uid,
            name,
            url: normalizedUrl,
            sourceUrl: normalizedUrl,
            createdAt: existingData?.createdAt || now,
            updatedAt: now,
            status: "processing",
            generationStatus: "processing",
            generation: {
              status: "processing",
              stage: "queued",
              progress: 0,
              title: "Generating website",
              jobId: acceptedJobId,
              requestId: appResponse.reqId || null,
              archiveZipPath: typeof appData.archiveZipPath === "string" ? appData.archiveZipPath : null,
              archiveZipUrl: typeof appData.archiveZipUrl === "string" ? appData.archiveZipUrl : null,
              errorCode: null,
              details: null,
              retryable: Boolean(appData.rescanRecommended),
              needsRescan: appData.rescanRecommended === true,
              nextAction: appData.rescanRecommended ? "rescan_url" : null,
            },
            warnings: Array.isArray(appData.warnings) ? appData.warnings : [],
            rescanRecommended: appData.rescanRecommended === true,
            archiveZipPath: typeof appData.archiveZipPath === "string" ? appData.archiveZipPath : null,
            generationFormat: appData.generationFormat === "html" ? "html" : "nextjs",
            files: existingData?.files || {},
            pendingCompleted: false,
          }, { merge: true });
        } catch (err: any) {
          await reportZipGenerationFailure({
            req,
            uid: decoded.uid,
            url: normalizedUrl,
            name,
            reason: "app_doc_write_failed",
            statusCode: 502,
            reqId: appResponse.reqId,
            backendMessage: err?.message || String(err) || "Failed to write app document",
            appId: acceptedAppId,
          }).catch(() => null);

          return NextResponse.json(
            {
              error: "We accepted the generation job, but failed to save the website record.",
              code: "APP_DOC_WRITE_FAILED",
              reqId: appResponse.reqId,
              appId: acceptedAppId,
              jobId: acceptedJobId,
            },
            { status: 502 },
          );
        }

        return NextResponse.json(
          {
            message: appData.message || "App generation started. Check back later.",
            status: appData.status || "processing",
            appId: acceptedAppId || appData.appId,
            jobId: acceptedJobId,
            accepted: true,
            reqId: appResponse.reqId,
            warnings: Array.isArray(appData.warnings) ? appData.warnings : [],
            rescanRecommended: appData.rescanRecommended === true,
            archiveZipPath: typeof appData.archiveZipPath === "string" ? appData.archiveZipPath : null,
            generationFormat: appData.generationFormat === "html" ? "html" : "nextjs",
          },
          { status: 202 },
        );
      }

      const appData = (appResponse.json || {}) as any;
      const upstreamStatus = appResponse.status || 502;

      if (upstreamStatus === 404) {
        const routePath = typeof appData?.path === "string" && appData.path.trim() ? appData.path.trim() : null;
        const routeScope = typeof appData?.scope === "string" && appData.scope.trim() ? appData.scope.trim() : null;
        const backendMessage = appData.error || appData.message || "Not found";

        await reportZipGenerationFailure({
          req,
          uid: decoded.uid,
          url: normalizedUrl,
          name,
          reason: "backend_route_not_found",
          statusCode: 404,
          reqId: appResponse.reqId,
          backendUrl: appResponse.url,
          backendStatus: appResponse.status,
          backendMessage,
        }).catch(() => null);

        return NextResponse.json(
          {
            error: "The generation service is temporarily unavailable. Please try again in a bit.",
            code: "BACKEND_ROUTE_NOT_FOUND",
            reqId: appResponse.reqId,
            upstreamStatus,
            scope: routeScope,
            path: routePath,
            details: {
              backendError: backendMessage,
              scope: routeScope,
              path: routePath,
            },
          },
          { status: 404 },
        );
      }

      await reportZipGenerationFailure({
        req,
        uid: decoded.uid,
        url: normalizedUrl,
        name,
        reason: "backend_rejected_generation",
        statusCode: upstreamStatus >= 400 ? upstreamStatus : 502,
        reqId: appResponse.reqId,
        backendUrl: appResponse.url,
        backendStatus: appResponse.status,
        backendMessage: appData.error || appData.message || `Backend refused app generation (HTTP ${upstreamStatus})`,
        appId: typeof appData?.appId === "string" ? appData.appId.trim() : null,
      }).catch(() => null);
      return NextResponse.json(
        {
          error:
            appData.error ||
            appData.message ||
            `Backend refused app generation (HTTP ${upstreamStatus})`,
          upstreamStatus,
          reqId: appResponse.reqId,
        },
        { status: upstreamStatus >= 400 ? upstreamStatus : 502 },
      );

    } catch (e: any) {
      await reportZipGenerationFailure({
        req,
        uid: decoded.uid,
        url: normalizedUrl,
        name,
        reason: "request_failed",
        statusCode: 502,
        backendMessage: e?.message || "Request failed",
      }).catch(() => null);
      return NextResponse.json(
        { error: e?.message || "Request failed" },
        { status: 502 }
      );
    }
  });
}