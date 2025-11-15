import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAdminDb } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.VERCEL_WEBHOOK_SECRET || "";

type VercelWebhookPayload = {
    type: string;
    id: string;
    createdAt?: number | string;
    payload?: any;
};

type DeploymentPayload = {
    configurationId?: string;
    team?: { id?: string | null } | null;
    user?: { id?: string | null } | null;
    project?: {
        id?: string;
        name?: string;
        framework?: string | null;
        createdAt?: number;
    } | null;
    deployment?: {
        id?: string;
        url?: string;
        state?: string;
        createdAt?: number;
        meta?: Record<string, any>;
    } | null;
};

function verifySignature(rawBody: string, signature: string | null): boolean {
    if (!WEBHOOK_SECRET || !signature) return false;
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(rawBody, "utf8");
    const digest = hmac.digest("hex");
    try {
        return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch {
        return false;
    }
}

const db = getAdminDb();

/**
 * Resolve which Kloner user owns this Vercel installation.
 * We store Vercel integration docs at:
 *   kloner_users/{uid}/integrations/vercel
 * So the collectionGroup we query is "integrations", not "vercel".
 */
async function resolveUserFromDeploymentPayload(
    payload: DeploymentPayload
): Promise<{ uid: string; integrationRef: FirebaseFirestore.DocumentReference } | null> {
    const configurationId = payload.configurationId;
    const teamId = payload.team?.id || null;
    const userId = payload.user?.id || null;

    // 1) configurationId match against /kloner_users/{uid}/integrations/vercel
    if (configurationId) {
        const col = db.collectionGroup("integrations");
        const snap = await col.where("configurationId", "==", configurationId).limit(1).get();

        if (!snap.empty) {
            const doc = snap.docs[0];
            const parts = doc.ref.path.split("/");
            const idx = parts.indexOf("kloner_users") + 1;
            const uid = parts[idx];
            return { uid, integrationRef: doc.ref };
        }
    }

    // 2) fallback on teamId/userId
    if (teamId || userId) {
        const col = db.collectionGroup("integrations");
        let q: FirebaseFirestore.Query = col;

        if (teamId) q = q.where("vercelTeamId", "==", teamId);
        if (userId) q = q.where("vercelUserId", "==", userId);

        const snap = await q.limit(1).get();
        if (!snap.empty) {
            const doc = snap.docs[0];
            const parts = doc.ref.path.split("/");
            const idx = parts.indexOf("kloner_users") + 1;
            const uid = parts[idx];
            return { uid, integrationRef: doc.ref };
        }
    }

    return null;
}

/** Map Vercel deployment.state + event type into a canonical state string */
function deriveCanonicalState(type: string, rawState?: string | null): string {
    const t = type.toLowerCase();
    const s = (rawState || "").toString().toLowerCase();

    // Event type wins if it clearly indicates failure/success/cancel.
    if (t.includes("error")) return "error";
    if (t.includes("canceled")) return "canceled";
    if (t.includes("succeeded") || t.includes("ready") || t.includes("promoted")) return "ready";

    if (["error", "failed"].includes(s)) return "error";
    if (["canceled", "cancelled"].includes(s)) return "canceled";
    if (["ready", "succeeded"].includes(s)) return "ready";
    if (["queued", "pending", "building"].includes(s)) return "building";

    // Default for created / cleanup etc.
    return s || "building";
}

async function upsertDeploymentRecord(
    type: string,
    eventId: string,
    payload: DeploymentPayload
): Promise<void> {
    const deployment = payload.deployment;
    const project = payload.project;

    if (!deployment?.id) {
        console.warn("[vercel-webhook] missing deployment.id", { type, eventId });
        return;
    }

    const owner = await resolveUserFromDeploymentPayload(payload);
    if (!owner) {
        console.warn("[vercel-webhook] no kloner user for deployment", {
            type,
            eventId,
            deploymentId: deployment.id,
            configurationId: payload.configurationId,
            teamId: payload.team?.id,
            userId: payload.user?.id,
        });
        return;
    }

    const { uid } = owner;
    const deploymentsCol = db.collection("kloner_users").doc(uid).collection("deployments");

    const depRef = deploymentsCol.doc(deployment.id);
    const now = new Date();

    const canonicalState = deriveCanonicalState(type, deployment.state);

    const baseData: Record<string, any> = {
        vercelDeploymentId: deployment.id,
        vercelProjectId: project?.id || null,
        vercelProjectName: project?.name || null,
        vercelUrl: deployment.url || null,
        vercelState: canonicalState,
        vercelTeamId: payload.team?.id || null,
        vercelUserId: payload.user?.id || null,
        configurationId: payload.configurationId || null,
        lastEventType: type,
        lastEventId: eventId,
        lastEventAt: now,
        meta: deployment.meta || {},
    };

    const createdAt =
        typeof deployment.createdAt === "number" ? new Date(deployment.createdAt) : now;

    await depRef.set(
        {
            ...baseData,
            createdAt,
            updatedAt: now,
        },
        { merge: true }
    );
}

export async function POST(req: NextRequest) {
    const rawBody = await req.text();
    const signature = req.headers.get("x-vercel-signature");

    if (!verifySignature(rawBody, signature)) {
        console.warn("[vercel-webhook] invalid signature");
        return NextResponse.json(
            { ok: false, error: "Invalid signature" },
            { status: 401 }
        );
    }

    let event: VercelWebhookPayload;
    try {
        event = JSON.parse(rawBody);
    } catch (e) {
        console.error("[vercel-webhook] invalid JSON", e);
        return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const { type, id } = event;

    try {
        switch (type) {
            case "deployment.created":
            case "deployment.succeeded":
            case "deployment.error":
            case "deployment.canceled":
            case "deployment.promoted":
            case "deployment.ready":
            case "deployment.cleanup": {
                const payload = (event.payload || {}) as DeploymentPayload;
                await upsertDeploymentRecord(type, id, payload);
                break;
            }

            case "project.created":
            case "project.removed":
            case "project.domain.created":
            case "project.domain.deleted":
            case "project.domain.verified":
            case "project.domain.unverified":
            case "integration-configuration.permission-upgraded":
            case "integration-configuration.scope-change-confirmed":
            case "integration-configuration.removed":
                console.log("[vercel-webhook] project/config event", type, {
                    id,
                    configurationId: event.payload?.configurationId,
                    projectId: event.payload?.project?.id,
                    projectName: event.payload?.project?.name,
                });
                break;

            default:
                console.log("[vercel-webhook] ignoring event", type);
                break;
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("[vercel-webhook] handler error", type, id, e);
        return NextResponse.json(
            { ok: false, error: "Internal error in webhook handler" },
            { status: 500 }
        );
    }
}
