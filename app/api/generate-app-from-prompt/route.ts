// app/api/generate-app-from-prompt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return requireSessionAndMaybeCsrf(req, async ({ req }) => {
    return NextResponse.json(
      {
        error: "Prompt-based generation is no longer available.",
        code: "PROMPT_GENERATION_DISABLED",
      },
      { status: 410 },
    );
  });
}