import { NextRequest, NextResponse } from "next/server";
import { captureAuditEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSameOriginPage(req: NextRequest, requestedPage: unknown): string {
    const referer = req.headers.get("referer") || "";
    try {
        if (referer) return new URL(referer).pathname.slice(0, 300) || "/";
    } catch {
        // Fall back to the sanitized path supplied by the banner.
    }

    if (typeof requestedPage !== "string" || !requestedPage.startsWith("/") || requestedPage.startsWith("//")) {
        return "/";
    }

    try {
        return new URL(requestedPage, req.nextUrl.origin).pathname.slice(0, 300) || "/";
    } catch {
        return "/";
    }
}

export async function POST(req: NextRequest) {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
        return NextResponse.json({ ok: false }, { status: 415 });
    }

    const origin = req.headers.get("origin");
    if (!origin) return NextResponse.json({ ok: false }, { status: 403 });
    try {
        if (new URL(origin).host !== req.nextUrl.host) {
            return NextResponse.json({ ok: false }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ ok: false }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const page = getSameOriginPage(req, body?.page);
    await captureAuditEvent({
        source: "frontend",
        component: "browser",
        severity: "info",
        alwaysNotifySlack: true,
        statusCode: 200,
        route: "/api/marketing/moqup-banner-click",
        method: "POST",
        page,
        action: "moqup_banner_clicked",
        service: "marketing-attribution",
        message: `A visitor clicked the Moqup banner from ${page} and headed to Moqup. Attribution: utm_source=kloner, utm_medium=referral, utm_campaign=global_banner.`,
        extra: {
            landingPage: page,
            destination: "https://moqup.app/",
            utmSource: "kloner",
            utmMedium: "referral",
            utmCampaign: "global_banner",
        },
    });

    return NextResponse.json({ ok: true });
}
