// app/api/affiliate/apply/route.ts
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

async function requireUser(req: Request) {
    const token = pickBearer(req);
    if (!token) return null;
    getAdminApp();
    return await admin.auth().verifyIdToken(token);
}

function cleanStr(v: any, max = 4000) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function cleanHandle(v: any, max = 100) {
    const s = cleanStr(v, max);
    return s.replace(/^@+/, "");
}

function isEmail(v: string) {
    const s = v.trim();
    return s.includes("@") && s.includes(".");
}

export async function POST(req: Request) {
    try {
        const decoded = await requireUser(req);
        if (!decoded?.uid) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

        const body = await req.json().catch(() => null);
        if (!body) return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });

        const uid = decoded.uid;
        const email = cleanStr(body.email || decoded.email || "", 254).toLowerCase();
        if (!email || !isEmail(email)) {
            return NextResponse.json({ ok: false, error: "Valid email required" }, { status: 400 });
        }

        // Minimal onboarding set (keep tax/payout details out of this page if you want)
        const payload = {
            uid,
            email,
            fullName: cleanStr(body.fullName, 160),
            country: cleanStr(body.country, 80),
            website: cleanStr(body.website, 300),
            promoPlan: cleanStr(body.promoPlan, 1200),
            niche: cleanStr(body.niche, 120),
            audienceSize: cleanStr(body.audienceSize, 80),
            channels: Array.isArray(body.channels) ? body.channels.map((x: any) => cleanStr(x, 40)).slice(0, 12) : [],
            socials: {
                instagram: cleanHandle(body?.socials?.instagram),
                tiktok: cleanHandle(body?.socials?.tiktok),
                youtube: cleanHandle(body?.socials?.youtube),
                twitter: cleanHandle(body?.socials?.twitter),
                linkedin: cleanHandle(body?.socials?.linkedin),
            },
            agreedToTerms: !!body.agreedToTerms,
            status: "pending",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (!payload.agreedToTerms) {
            return NextResponse.json({ ok: false, error: "You must agree to the affiliate terms" }, { status: 400 });
        }

        const db = getAdminApp().firestore();

        // If already assigned a code, block applying
        const affSnap = await db.collection("affiliates").where("uid", "==", uid).limit(1).get();
        if (!affSnap.empty) {
            return NextResponse.json({ ok: false, error: "You already have an affiliate code assigned" }, { status: 409 });
        }

        await db.collection("affiliate_applications").doc(uid).set(payload, { merge: true });

        return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: String(e?.message || "Apply failed") }, { status: 500 });
    }
}
