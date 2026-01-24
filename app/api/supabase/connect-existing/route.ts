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

            const projectRef = normalizeProjectRef(projectRefInput);
            if (!projectRef || !isPlausibleProjectRef(projectRef)) {
                return NextResponse.json({ ok: false, error: "Invalid Project Reference ID / Supabase URL" }, { status: 400 });
            }

            if (!anonKey.trim()) {
                return NextResponse.json({ ok: false, error: "Missing anon key" }, { status: 400 });
            }

            const db = getAdminDb();
            const integrationRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("supabase");

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
