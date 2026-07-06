import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { makeSignedToken } from "@/app/api/private/email-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const origin = new URL(req.url).origin.replace(/\/$/, "");
            const url = new URL(`${origin}/api/billing/recovery-checkout`);
            const token = makeSignedToken({ uid, k: "exit40", ts: Date.now() });
            url.searchParams.set("t", token);
            return NextResponse.json({ ok: true, url: url.toString() }, { status: 200 });
        },
        { methods: ["GET"] },
    );
}
