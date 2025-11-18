// app/api/site/[siteId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// minimal admin init
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT missing for site API");
    }

    let credJson: admin.ServiceAccount;
    try {
        credJson = JSON.parse(raw);
    } catch {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        credJson = JSON.parse(decoded);
    }

    admin.initializeApp({
        credential: admin.credential.cert(credJson),
    });
}

const db = admin.firestore();

type Params = { params: { siteId: string } };

// GET: load siteConfig + overridesCss for logged-in user
export async function GET(req: NextRequest, { params }: Params) {
    let uid: string;
    try {
        const session = await verifySession(req);
        uid = session.uid;
    } catch {
        return NextResponse.json(
            { error: "Not authenticated" },
            { status: 401 }
        );
    }

    const { siteId } = params;

    const docRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_sites")
        .doc(siteId);

    const snap = await docRef.get();
    if (!snap.exists) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = snap.data() || {};
    const siteConfig = data.siteConfig;
    const overridesCss = data.siteOverridesCss || "";

    return NextResponse.json({ siteConfig, overridesCss });
}

// PATCH: save updated siteConfig for logged-in user
export async function PATCH(req: NextRequest, { params }: Params) {
    let uid: string;
    try {
        const session = await verifySession(req);
        uid = session.uid;
    } catch {
        return NextResponse.json(
            { error: "Not authenticated" },
            { status: 401 }
        );
    }

    const { siteId } = params;

    const body = await req.json().catch(() => null);
    if (!body || !body.siteConfig) {
        return NextResponse.json(
            { error: "Missing siteConfig" },
            { status: 400 }
        );
    }

    await db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_sites")
        .doc(siteId)
        .set(
            {
                siteConfig: body.siteConfig,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

    return NextResponse.json({ ok: true });
}
