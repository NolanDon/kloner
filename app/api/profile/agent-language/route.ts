import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { normalizeAgentLanguage } from "@/src/lib/agentLanguage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const snap = await getAdminDb().collection("kloner_users").doc(uid).get();
        const profile = snap.exists ? snap.data() || {} : {};
        return NextResponse.json({
            language: normalizeAgentLanguage(profile.agentLanguagePreference),
            prompted: profile.agentLanguagePromptedAt != null,
        });
    }, { methods: ["GET"] });
}

export async function PATCH(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const body = await req.json().catch(() => null);
        const language = body?.language == null ? null : normalizeAgentLanguage(body.language);
        if (body?.language != null && !language) return NextResponse.json({ error: "Unsupported language preference." }, { status: 400 });
        if (!language && body?.prompted !== true) return NextResponse.json({ error: "Language preference required." }, { status: 400 });
        const updates: Record<string, unknown> = {};
        if (language) {
            updates.agentLanguagePreference = language;
            updates.agentLanguagePreferenceUpdatedAt = new Date();
        }
        if (body?.prompted === true) updates.agentLanguagePromptedAt = new Date();
        await getAdminDb().collection("kloner_users").doc(uid).set(updates, { merge: true });
        return NextResponse.json({ ok: true, language });
    }, { csrf: true, methods: ["PATCH"] });
}
