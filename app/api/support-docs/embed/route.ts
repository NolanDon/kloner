// app/api/support-docs/embed/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SUPPORT_DOCS_COLLECTION = "support_doc";

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        try {
            // ensure Admin SDK is initialized (your helper likely does this)
            const db = getAdminDb();

            // admin-only via custom claims
            const user = await admin.auth().getUser(uid);
            const isAdmin = user.customClaims?.admin === true;
            if (!isAdmin) {
                return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
            }

            const colRef = db.collection(SUPPORT_DOCS_COLLECTION);
            const snap = await colRef.get();

            if (snap.empty) {
                return NextResponse.json({ ok: false, error: "No support docs found" }, { status: 404 });
            }

            let updated = 0;
            const errors: { id: string; error: string }[] = [];

            for (const docSnap of snap.docs) {
                const data = docSnap.data() as any;
                const rawText = (data.text || "").toString().trim();

                if (!rawText) {
                    errors.push({ id: docSnap.id, error: "Missing text field" });
                    continue;
                }

                try {
                    const embRes = await openai.embeddings.create({
                        model: "text-embedding-3-small",
                        input: rawText,
                    });

                    const embedding = embRes.data[0]?.embedding;
                    if (!embedding || !Array.isArray(embedding)) {
                        errors.push({ id: docSnap.id, error: "No embedding returned" });
                        continue;
                    }

                    await docSnap.ref.set(
                        { embedding, updatedAt: new Date() },
                        { merge: true },
                    );

                    updated += 1;
                } catch (err: any) {
                    console.error("Failed to embed support doc", docSnap.id, err);
                    errors.push({ id: docSnap.id, error: err?.message ?? "Unknown error" });
                }
            }

            return NextResponse.json({ ok: true, updated, errors });
        } catch (err: any) {
            console.error("support-docs embed route failed", err);
            return NextResponse.json(
                { ok: false, error: err?.message || "embed_failed" },
                { status: 500 },
            );
        }
    });
}
