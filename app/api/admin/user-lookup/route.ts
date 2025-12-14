import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { requireAdmin } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanEmail(v: string) {
    return (v || "").trim().toLowerCase().slice(0, 254);
}

function deny() {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}

function bad(msg: string) {
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

    let cred: admin.ServiceAccount;
    try {
        cred = JSON.parse(raw);
    } catch {
        cred = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    }

    admin.initializeApp({ credential: admin.credential.cert(cred) });
}

const db = admin.firestore();

export async function GET(req: NextRequest) {
    const gate = await requireAdmin(req);
    if (!gate.ok) return deny();

    const { searchParams } = new URL(req.url);
    const email = cleanEmail(searchParams.get("email") || "");
    if (!email || !email.includes("@")) return bad("Missing email");

    try {
        const user = await admin.auth().getUserByEmail(email);
        const uid = user.uid;

        const userRef = db.collection("kloner_users").doc(uid);
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? (userSnap.data() as any) : {};

        // Cache email onto kloner_users for faster Firestore-only searches later
        // (safe, non-sensitive, and helps your admin tooling).
        await userRef.set(
            {
                email: user.email || email,
                emailLower: (user.email || email).toLowerCase(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        return NextResponse.json({
            ok: true,
            uid,
            auth: {
                email: user.email || null,
                emailVerified: user.emailVerified || false,
                disabled: user.disabled || false,
                createdAt: user.metadata?.creationTime || null,
                lastSignInAt: user.metadata?.lastSignInTime || null,
                providerIds: (user.providerData || []).map((p) => p.providerId),
            },
            klonerUser: userData || {},
        });
    } catch (e: any) {
        const msg = typeof e?.message === "string" ? e.message : "Lookup failed";
        return NextResponse.json({ ok: false, error: msg }, { status: 404 });
    }
}
