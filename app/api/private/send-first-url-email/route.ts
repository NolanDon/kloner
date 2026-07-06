import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async () => NextResponse.json({ ok: true, sent: false, disabled: true }, { headers: { "Cache-Control": "no-store" } }),
        { methods: ["POST"], csrf: false },
    );
}
