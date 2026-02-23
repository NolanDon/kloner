// app/api/support-docs/embed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const GEMINI_EMBEDDING_MODEL = "models/embedding-001";
const SUPPORT_DOCS_COLLECTION = "support_doc";
const MODEL_DISCOVERY_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiModelInfo = {
    name?: string;
    supportedGenerationMethods?: string[];
};

function normalizeModelName(name: string): string {
    return name.replace(/^models\//, "");
}

async function listEmbeddingModels(): Promise<string[]> {
    if (!GEMINI_API_KEY) return [];
    const url = `${MODEL_DISCOVERY_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) {
        throw new Error(`ListModels failed: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as { models?: GeminiModelInfo[] };
    const models = payload.models || [];
    return models
        .filter((model) => model.supportedGenerationMethods?.includes("embedContent"))
        .map((model) => normalizeModelName(model.name || ""))
        .filter(Boolean);
}

function uniqueModels(list: string[]): string[] {
    return Array.from(new Set(list.filter(Boolean)));
}

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

            if (!geminiClient) {
                return NextResponse.json(
                    { ok: false, error: "Gemini API key not configured" },
                    { status: 503 },
                );
            }

            const colRef = db.collection(SUPPORT_DOCS_COLLECTION);
            const snap = await colRef.get();

            if (snap.empty) {
                return NextResponse.json({ ok: false, error: "No support docs found" }, { status: 404 });
            }

            const discoveredEmbeddingModels = await listEmbeddingModels().catch((err) => {
                console.warn("[support-docs/embed] failed to discover embedding models", err);
                return [] as string[];
            });

            const embeddingCandidates = uniqueModels([
                normalizeModelName(GEMINI_EMBEDDING_MODEL),
                "text-embedding-004",
                "text-embedding-005",
                "embedding-001",
                ...discoveredEmbeddingModels,
            ]);

            let updated = 0;
            let selectedModel: string | null = null;
            const errors: { id: string; error: string }[] = [];

            const embedWithCandidates = async (text: string): Promise<number[] | null> => {
                const candidates = selectedModel
                    ? [selectedModel, ...embeddingCandidates.filter((name) => name !== selectedModel)]
                    : embeddingCandidates;

                for (const modelName of candidates) {
                    try {
                        const embModel = geminiClient.getGenerativeModel({ model: modelName });
                        const embRes = await embModel.embedContent(text);
                        const values = embRes.embedding?.values;
                        if (values && values.length > 0) {
                            selectedModel = modelName;
                            return Array.from(values);
                        }
                    } catch (err) {
                        const msg = String((err as any)?.message ?? "");
                        console.warn(`[support-docs/embed] model failed: ${modelName}`, msg);
                    }
                }

                return null;
            };

            for (const docSnap of snap.docs) {
                const data = docSnap.data() as any;
                const rawText = (data.text || "").toString().trim();

                if (!rawText) {
                    errors.push({ id: docSnap.id, error: "Missing text field" });
                    continue;
                }

                try {
                    const embedding = await embedWithCandidates(rawText);
                    if (!embedding) {
                        errors.push({ id: docSnap.id, error: "No embedding returned from available models" });
                        continue;
                    }

                    await docSnap.ref.set(
                        {
                            embedding,
                            embeddingModel: selectedModel,
                            updatedAt: new Date(),
                        },
                        { merge: true },
                    );

                    updated += 1;
                } catch (err: any) {
                    console.error("Failed to embed support doc", docSnap.id, err);
                    errors.push({ id: docSnap.id, error: err?.message ?? "Unknown error" });
                }
            }

            return NextResponse.json({
                ok: true,
                updated,
                errors,
                selectedModel,
                triedModels: embeddingCandidates,
            });
        } catch (err: any) {
            console.error("support-docs embed route failed", err);
            return NextResponse.json(
                { ok: false, error: err?.message || "embed_failed" },
                { status: 500 },
            );
        }
    });
}
