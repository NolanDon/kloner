import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "../../_lib/route-guard";
import { getSignupBlockDecision } from "@/src/lib/signupBlocklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email : null;
    const ip = getClientIp(req);

    const decision = getSignupBlockDecision({ email, ip });

    return NextResponse.json({
        ok: true,
        blocked: decision.blocked,
        reason: decision.reason,
        matchedBy: decision.matchedBy,
    });
}