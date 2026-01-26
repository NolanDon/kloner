// app/api/generate-app-from-prompt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { callBackend } from "@/src/lib/callBackend";
import { getAuthoritativeUserTier } from "../_lib/userTier";
import { verifySession } from "../_lib/auth";
import type { UserTier } from "@/src/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

      // Treat any 2xx as a successful "job accepted".
      if (backendResponse.status >= 200 && backendResponse.status < 300) {
        const appData = (backendResponse.json || {}) as any;
        return NextResponse.json(
          {
            message: appData.message || "App generation started. Check back later.",
            status: appData.status || "processing",
            appId: appData.appId,
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