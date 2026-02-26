// app/api/supabase/connect-existing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";
import { encryptString } from "../../_lib/crypto";

export const runtime = "nodejs";

function normalizeProjectRef(input: string): string {
    const raw = String(input || "").trim();
    if (!raw) return "";

    // Accept full Supabase URL or a bare project ref.
    try {
        if (/^https?:\/\//i.test(raw)) {
            const url = new URL(raw);
            const host = url.hostname || "";
            const first = host.split(".")[0] || "";
            return first.trim();
        }
    } catch {
        // fall through
    }

    // If user pasted something like abcdefg.supabase.co
    const hostish = raw.replace(/^https?:\/\//i, "").split("/")[0] || raw;
    const first = hostish.split(".")[0] || hostish;
    return first.trim();
}

function isPlausibleProjectRef(ref: string): boolean {
    const r = ref.trim();
    // Typical Supabase ref is 20 chars, but avoid being too strict.
    return /^[a-z0-9][a-z0-9-]{7,40}$/i.test(r);
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const projectRefInput = typeof body?.projectRef === "string" ? body.projectRef : "";
            const anonKey = typeof body?.anonKey === "string" ? body.anonKey : "";
            const serviceRoleKey = typeof body?.serviceRoleKey === "string" ? body.serviceRoleKey : "";

            const rawAppId = typeof body?.appId === "string" ? body.appId.trim() : "";

            const projectRef = normalizeProjectRef(projectRefInput);
            if (!projectRef || !isPlausibleProjectRef(projectRef)) {
                return NextResponse.json({ ok: false, error: "Invalid Project Reference ID / Supabase URL" }, { status: 400 });
            }

            if (!anonKey.trim()) {
                return NextResponse.json({ ok: false, error: "Missing anon key" }, { status: 400 });
            }

            const db = getAdminDb();

            // Enforce 1:1 binding: if the integration already belongs to a different app, reject.
            const existingRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("supabase");
            const existingSnap = await existingRef.get();
            if (existingSnap.exists) {
                const existingData = existingSnap.data() as any;
                const storedBoundAppId = typeof existingData?.boundAppId === "string" && existingData.boundAppId.trim()
                    ? existingData.boundAppId.trim()
                    : null;
                if (storedBoundAppId && rawAppId && storedBoundAppId !== rawAppId) {
                    return NextResponse.json(
                        { ok: false, error: "A different Kloner project is already connected to a Supabase instance. Disconnect it first before connecting a new project." },
                        { status: 409 },
                    );
                }
            }

            const integrationRef = existingRef;

            await integrationRef.set(
                {
                    provider: "supabase",
                    mode: "manual",
                    status: "CONNECTED",
                    projectId: projectRef,
                    projectRef,
                    projectName: null,
                    supabaseUrl: `https://${projectRef}.supabase.co`,
                    anonKey: encryptString(anonKey.trim()),
                    serviceRoleKey: serviceRoleKey.trim() ? encryptString(serviceRoleKey.trim()) : null,
                    // Bind to the specific Kloner app that initiated this connection (1:1 guarantee).
                    boundAppId: rawAppId || null,
                    updatedAt: new Date(),
                    createdAt: new Date(),
                },
                { merge: true },
            );

            return NextResponse.json({ ok: true });
        },
        { csrf: true, methods: ["POST"] },
    );
}
