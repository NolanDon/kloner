import { NextResponse } from "next/server";
import admin from "firebase-admin";

function getAdminApp() {
    if (admin.apps.length) return admin.app();

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error("Missing Firebase Admin env vars (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)");
    }

    privateKey = privateKey.replace(/\\n/g, "\n");

    return admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
}

function pickBearer(req: Request): string | null {
    const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}

async function requireAdmin(req: Request) {
    const token = pickBearer(req);
    if (!token) return { ok: false as const, status: 401, msg: "Missing Bearer token" };

    getAdminApp();

    const decoded = await admin.auth().verifyIdToken(token);
    const adminClaim = (decoded as any)?.admin;
    const ok = adminClaim === true || adminClaim === "true" || adminClaim === 1;

    if (!ok) return { ok: false as const, status: 403, msg: "Not admin" };
    return { ok: true as const };
}

function codeNorm(v: string) {
    return (v || "").trim().toUpperCase();
}

export async function GET(req: Request) {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) return NextResponse.json({ ok: false, error: gate.msg }, { status: gate.status });

        const url = new URL(req.url);
        const code = codeNorm(url.searchParams.get("code") || "");
        if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });

        const db = getAdminApp().firestore();

        const ref = db.collection("affiliate_codes").doc(code);
        const snap = await ref.get();

        if (!snap.exists) {
            return NextResponse.json({ ok: false, error: "Affiliate not found" }, { status: 404 });
        }

        const data = snap.data() as any;

        return NextResponse.json({
            ok: true,
            affiliate: {
                code,
                uid: typeof data?.uid === "string" ? data.uid : null,
                status: typeof data?.status === "string" ? data.status : "active",
                createdAtMs: typeof data?.createdAt?.toMillis === "function" ? data.createdAt.toMillis() : null,
                updatedAtMs: typeof data?.updatedAt?.toMillis === "function" ? data.updatedAt.toMillis() : null,
            },
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
    }
}
