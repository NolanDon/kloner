import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "../../_lib/route-guard";
import { getSignupBlockDecision } from "@/src/lib/signupBlocklist";
import { sendBlockedSignupIpAlert } from "../../_lib/signupBlocklistAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email : null;
    const ip = getClientIp(req);

    const decision = getSignupBlockDecision({ email, ip });

    if (decision.blocked && decision.matchedBy === "ip" && ip) {
        await sendBlockedSignupIpAlert({
            ip,
            email,
            route: "/api/private/signup-blocklist",
            matchedBy: "ip",
            userAgent: req.headers.get("user-agent"),
        });
    }

    return NextResponse.json({
        ok: true,
        blocked: decision.blocked,
        reason: decision.reason,
        matchedBy: decision.matchedBy,
    });
}