// app/api/vercel/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.VERCEL_WEBHOOK_SECRET || "";

// Basic type; extend as needed
type VercelWebhookPayload = {
    type: string;
    id: string;
    createdAt?: string;
    payload?: any;
};

function verifySignature(rawBody: string, signature: string | null): boolean {
    if (!WEBHOOK_SECRET || !signature) return false;
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(rawBody, "utf8");
    const digest = hmac.digest("hex");
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export async function POST(req: NextRequest) {
    const rawBody = await req.text();
    const signature = req.headers.get("x-vercel-signature");

    if (!verifySignature(rawBody, signature)) {
        return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    let event: VercelWebhookPayload;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    // Minimal routing on event type
    switch (event.type) {
        case "deployment.created":
        case "deployment.succeeded":
        case "deployment.error":
        case "deployment.canceled":
            // TODO: persist deployment state for the corresponding user / configuration
            // e.g. write to Firestore keyed by event.payload.projectId / deploymentId
            break;

        case "project.created":
        case "project.removed":
            // TODO: sync project metadata if you care
            break;

        default:
            // Ignore unhandled events
            break;
    }

    // Acknowledge quickly so Vercel doesn’t retry
    return NextResponse.json({ ok: true });
}
