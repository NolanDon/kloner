// app/s/settings/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const dest = `https://kloner.app/settings?tab=notifications${qs ? `&${qs}` : ""}`;
    return NextResponse.redirect(dest, 302);
}
