// app/api/vercel/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
    }

    let svcJson: admin.ServiceAccount;
    try {
        svcJson = JSON.parse(raw);
    } catch {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        svcJson = JSON.parse(decoded);
    }

    admin.initializeApp({
        credential: admin.credential.cert(svcJson),
    });
}

const db = admin.firestore();

export async function POST(req: NextRequest) {
    let decoded;
    try {
        decoded = await verifySession(req);
    } catch {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const uid = decoded.uid;

    const vercelRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("integrations")
        .doc("vercel");

    try {
        await vercelRef.delete();
    } catch (err) {
        console.error("Vercel disconnect failed:", err);
        return NextResponse.json({ error: "failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
