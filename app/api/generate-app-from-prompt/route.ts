// app/api/generate-app-from-prompt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { callBackend } from "@/src/lib/callBackend";
import { getAuthoritativeUserTier } from "../_lib/userTier";
import { verifySession } from "../_lib/auth";
import type { UserTier } from "@/src/lib/credits";
import { peekUserCredit, consumeUserCredit } from "../_lib/credits-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backendConfigHint() {
  const origin = process.env.BACKEND_ORIGIN || process.env.BACKEND_URL || process.env.PUBLIC_ORIGIN || "";
  const prefix = process.env.BACKEND_PREFIX || "/api/v1";
  const hasInternalKey = Boolean(process.env.INTERNAL_API_KEY);
  return { origin, prefix, hasInternalKey };
}

function isBackendFetchFailed(resp: any) {
  return resp?.status === 502 && String(resp?.json?.error || "") === "Backend fetch failed";
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
    const { prompt, name } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    if (prompt.length > 2000) {
      return NextResponse.json({ error: "Prompt too long (max 2000 characters)" }, { status: 400 });
    }

    let tier: UserTier;
    try {
      tier = await getAuthoritativeUserTier(decoded.uid);
    } catch (e: any) {
      return NextResponse.json(
        {
          error: e?.message || "Unable to determine subscription tier. Try again shortly.",
        },
        { status: 500 }
      );
    }


    if (tier === "free") {
      return NextResponse.json(
        {
          error: "Upgrade to Pro to create websites or apps from the dashboard.",
          code: "APP_WIZARD_TIER_BLOCKED",
          reason: "app_wizard_tier_blocked",
          requiredTiers: ["trialing", "pro", "agency"],
        },
        { status: 403 },
      );
    }
    // Hard gate: app generation with createPreview consumes preview credits.
    try {
      const peek = await peekUserCredit(decoded.uid, tier, "preview");
      if (!peek.ok || (peek.remaining !== null && peek.remaining <= 0)) {
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
      return NextResponse.json(
        { error: "Unable to check preview credits. Try again shortly." },
        { status: 503 }
      );
    }

    try {
      // Call the backend to generate the app
      const backendResponse = await callBackend(req, {
        path: "/generate-app-from-prompt",
        method: "POST",
        body: { prompt, name, createPreview: true },
        userCtx: { uid: decoded.uid, email: decoded?.email || "", tier },
        timeoutMs: 300000, // 5 minutes timeout
        acceptOnTimeout: true, // Return 202 if it times out
      });

      if (isBackendFetchFailed(backendResponse)) {
        const hint = backendConfigHint();
        return NextResponse.json(
          {
            error:
              process.env.NODE_ENV !== "production"
                ? `Failed to reach the backend generation service at ${backendResponse.url}. Check BACKEND_URL/BACKEND_ORIGIN and INTERNAL_API_KEY. Also try /api/internal/env-check.`
                : "Failed to reach the backend generation service.",
            code: "BACKEND_UNREACHABLE",
            reqId: backendResponse.reqId,
            ...(process.env.NODE_ENV !== "production"
              ? {
                  debug: {
                    attemptedUrl: backendResponse.url,
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
      if (backendResponse.status >= 200 && backendResponse.status < 300) {
        const appData = (backendResponse.json || {}) as any;
        const acceptedAppId = typeof appData.appId === "string" ? appData.appId.trim() : "";

        // Charge one preview credit when generation is accepted with an appId.
        if (acceptedAppId) {
          try {
            await consumeUserCredit(decoded.uid, tier, "preview");
          } catch (err: any) {
            console.warn("consumeUserCredit failed (preview, generate-app-from-prompt)", {
              uid: decoded.uid,
              err: err?.message || String(err),
            });
          }
        }

        return NextResponse.json(
          {
            message: appData.message || "App generation started. Check back later.",
            status: appData.status || "processing",
            appId: acceptedAppId || appData.appId,
            reqId: backendResponse.reqId,
          },
          { status: 202 },
        );
      }

      const appData = (backendResponse.json || {}) as any;
      const upstreamStatus = backendResponse.status || 502;
      return NextResponse.json(
        {
          error:
            appData.error ||
            appData.message ||
            `Backend refused app generation (HTTP ${upstreamStatus})`,
          upstreamStatus,
          reqId: backendResponse.reqId,
        },
        { status: upstreamStatus >= 400 ? upstreamStatus : 502 },
      );

    } catch (error) {
      console.error("App generation failed:", error);
      return NextResponse.json({ error: "Failed to generate app from prompt" }, { status: 500 });
    }
  });
}