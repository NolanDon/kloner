// app/api/generate-app-from-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { callBackend } from "@/src/lib/callBackend";
import { getAuthoritativeUserTier } from "../_lib/userTier";
import { verifySession } from "../_lib/auth";
import type { UserTier } from "@/src/lib/credits";
import { peekUserCredit, consumeUserCredit } from "../_lib/credits-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isHttpUrl(s?: string): s is string {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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
    const { url, name, screenshotKey, screenshotKeys } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    if (!isHttpUrl(url)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const ownedPrefix = `kloner-screenshots/${decoded.uid}/`;
    const providedScreenshotKey = typeof screenshotKey === "string" && screenshotKey.trim() ? screenshotKey.trim() : null;
    const providedScreenshotKeys = Array.isArray(screenshotKeys)
      ? (screenshotKeys.filter((k: any) => typeof k === "string" && k.trim()).map((k: string) => k.trim()))
      : [];

    if (providedScreenshotKey && !providedScreenshotKey.startsWith(ownedPrefix)) {
      return NextResponse.json({ error: "Invalid screenshotKey" }, { status: 400 });
    }
    if (providedScreenshotKeys.some((k) => !k.startsWith(ownedPrefix))) {
      return NextResponse.json({ error: "Invalid screenshotKeys" }, { status: 400 });
    }

    const preferredScreenshotKey = providedScreenshotKey || (providedScreenshotKeys.length ? providedScreenshotKeys[0] : null);

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

    // Check snapshot credit only if we need to capture screenshots.
    if (!preferredScreenshotKey) {
      try {
        const peek = await peekUserCredit(decoded.uid, tier, "snapshot");
        if (!peek.ok || (peek.remaining !== null && peek.remaining <= 0)) {
          return NextResponse.json(
            {
              error: "Monthly snapshot limit reached for your plan.",
              remaining: peek.remaining,
            },
            { status: 429 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Unable to check credits. Try again shortly." },
          { status: 503 }
        );
      }
    }

    try {
      let finalScreenshotKey = preferredScreenshotKey;

      if (!finalScreenshotKey) {
        // First, generate screenshots
        const screenshotResponse = await callBackend(req, {
          path: "/generate-screenshots",
          method: "POST",
          body: { url },
          userCtx: { uid: decoded.uid, email: decoded?.email || "", tier },
          timeoutMs: 60000,
          acceptOnTimeout: true,
        });

        const screenshotPayload = screenshotResponse.json && Object.keys(screenshotResponse.json).length
          ? screenshotResponse.json
          : { ok: true, queued: screenshotResponse.status === 202 || screenshotResponse.status === 204 };

        const hasErrorFlag = Boolean((screenshotPayload as any).error);
        const okField = (screenshotPayload as any).ok;
        const totalPlanned = typeof (screenshotPayload as any).totalPlanned === "number"
          ? (screenshotPayload as any).totalPlanned
          : null;

        const logicalOk = screenshotResponse.upstream.ok &&
          !hasErrorFlag &&
          okField !== false &&
          (totalPlanned === null || totalPlanned > 0);

        if (!logicalOk) {
          const status = screenshotResponse.status && screenshotResponse.status >= 400
            ? screenshotResponse.status
            : 502;

          return NextResponse.json(
            {
              error: (screenshotPayload as any).error ||
                (screenshotPayload as any).message ||
                "Screenshot capture failed.",
              ...(totalPlanned === 0 ? { reason: "no_captures" } : {}),
            },
            { status }
          );
        }

        // Consume snapshot credit
        try {
          await consumeUserCredit(decoded.uid, tier, "snapshot");
        } catch {
          // If this fails, continue anyway
        }

        // Get the best screenshot key
        const items = (screenshotPayload as any).items || [];
        if (!items.length) {
          return NextResponse.json(
            { error: "No screenshots captured" },
            { status: 500 }
          );
        }

        finalScreenshotKey = items[0].key;
      }

      // Now generate the app using the screenshot
      const appResponse = await callBackend(req, {
        path: "/generate-app-from-url",
        method: "POST",
        body: { url, name, screenshotKey: finalScreenshotKey, createPreview: true },
        userCtx: { uid: decoded.uid, email: decoded?.email || "", tier },
        timeoutMs: 300000, // 5 minutes
        acceptOnTimeout: true,
      });

      // Treat any 2xx as a successful "job accepted".
      if (appResponse.status >= 200 && appResponse.status < 300) {
        const appData = (appResponse.json || {}) as any;
        return NextResponse.json(
          {
            message: appData.message || "App generation started. Check back later.",
            status: appData.status || "processing",
            appId: appData.appId,
            reqId: appResponse.reqId,
          },
          { status: 202 },
        );
      }

      const appData = (appResponse.json || {}) as any;
      const upstreamStatus = appResponse.status || 502;
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
      return NextResponse.json(
        { error: e?.message || "Request failed" },
        { status: 502 }
      );
    }
  });
}