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
    const { url, name } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    if (!isHttpUrl(url)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
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

    // Check snapshot credit before proceeding
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

    try {
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

      const screenshotKey = items[0].key;

      // Now generate the app using the screenshot
      const appResponse = await callBackend(req, {
        path: "/generate-app-from-url",
        method: "POST",
        body: { url, name, screenshotKey, createPreview: true },
        userCtx: { uid: decoded.uid, email: decoded?.email || "", tier },
        timeoutMs: 300000, // 5 minutes
        acceptOnTimeout: true,
      });

      // Backend always returns 202 for app generation
      if (appResponse.status === 202) {
        const appData = appResponse.json || {};
        return NextResponse.json({
          message: appData.message || "App generation started. Check back later.",
          status: appData.status || "processing",
          appId: appData.appId
        }, { status: 202 });
      }

      // If not 202, something went wrong
      return NextResponse.json(
        { error: "Failed to start app generation" },
        { status: 500 }
      );

    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Request failed" },
        { status: 502 }
      );
    }
  });
}