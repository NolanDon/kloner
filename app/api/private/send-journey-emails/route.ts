import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    const key = process.env.INTERNAL_API_KEY || "";
    const got = req.headers.get("x-internal-key") || "";
    if (!key || got !== key) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ ok: true, sent: 0, disabled: true }, { headers: { "Cache-Control": "no-store" } });
}
