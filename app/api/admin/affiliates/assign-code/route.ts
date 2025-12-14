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

function codeNorm(v: unknown) {
    return typeof v === "string" ? v.trim().toUpperCase() : "";
}

export async function POST(req: Request) {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) return NextResponse.json({ ok: false, error: gate.msg }, { status: gate.status });

        const body = await req.json().catch(() => ({}));
        const code = codeNorm(body.code);
        const uid = typeof body.uid === "string" ? body.uid.trim() : "";
        const force = body.force === true;

        if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
        if (!uid) return NextResponse.json({ ok: false, error: "Missing uid" }, { status: 400 });

        const db = getAdminApp().firestore();
        const ref = db.collection("affiliate_codes").doc(code);

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) {
                const err: any = new Error("Affiliate not found");
                err.status = 404;
                throw err;
            }

            const data = snap.data() as any;
            const existingUid = typeof data?.uid === "string" ? data.uid.trim() : "";

            if (existingUid && !force && existingUid !== uid) {
                const err: any = new Error("Code already assigned");
                err.status = 409;
                throw err;
            }

            tx.set(
                ref,
                {
                    uid,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        });

        return NextResponse.json({ ok: true, code, uid });
    } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status });
    }
}
