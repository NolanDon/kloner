// app/api/support-docs/embed/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getAdminDb } from "../../_lib/auth"; // same helper you use elsewhere

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// NOTE: if your collection is actually named "support_doc", change this.
const SUPPORT_DOCS_COLLECTION = "support_doc";

export async function POST(req: NextRequest) {
    try {
        // Optional: lock to dev so randoms can't hit it in prod
        if (process.env.NODE_ENV !== "development") {
            return NextResponse.json(
                { ok: false, error: "Embedding route disabled in production" },
                { status: 403 }
            );
        }

        const db = getAdminDb();
        const colRef = db.collection(SUPPORT_DOCS_COLLECTION);

        const snap = await colRef.get();
        if (snap.empty) {
            return NextResponse.json(
                { ok: false, error: "No support docs found" },
                { status: 404 }
            );
        }

        let updated = 0;
        const errors: { id: string; error: string }[] = [];

        for (const doc of snap.docs) {
            const data = doc.data() as any;
            const rawText = (data.text || "").toString().trim();

            if (!rawText) {
                errors.push({ id: doc.id, error: "Missing text field" });
                continue;
            }

            try {
                // Generate embedding for this doc
                const embRes = await openai.embeddings.create({
                    model: "text-embedding-3-small",
                    input: rawText,
                });

                const embedding = embRes.data[0]?.embedding;
                if (!embedding || !Array.isArray(embedding)) {
                    errors.push({ id: doc.id, error: "No embedding returned" });
                    continue;
                }

                // Save back to Firestore
                await doc.ref.set(
                    {
                        embedding,
                        updatedAt: new Date(),
                    },
                    { merge: true }
                );

                updated += 1;
            } catch (err: any) {
                console.error("Failed to embed support doc", doc.id, err);
                errors.push({ id: doc.id, error: err?.message ?? "Unknown error" });
            }
        }

        return NextResponse.json({
            ok: true,
            updated,
            errors,
        });
    } catch (err: any) {
        console.error("support-docs embed route failed", err);
        return NextResponse.json(
            { ok: false, error: "Failed to embed support docs" },
            { status: 500 }
        );
    }
}


// curl -X POST http://localhost:3000/api/support-docs/embed