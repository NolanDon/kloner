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

      // Backend always returns 202 for app generation
      if (backendResponse.status === 202) {
        const appData = backendResponse.json || {};
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

    } catch (error) {
      console.error("App generation failed:", error);
      return NextResponse.json({ error: "Failed to generate app from prompt" }, { status: 500 });
    }
  });
}