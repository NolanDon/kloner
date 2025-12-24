// app/s/unsub/route.ts
import { getAdminDb } from "@/app/api/_lib/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const uid = (url.searchParams.get("uid") || "").trim();
    const token = (url.searchParams.get("t") || "").trim();

    if (!uid || !token) {
        return NextResponse.redirect("https://kloner.app/settings?tab=notifications&unsub=missing", 302);
    }

    const db = getAdminDb();
    const ref = db.collection("kloner_users").doc(uid);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : null;

    const expected = typeof data?.notificationUnsubToken === "string" ? data.notificationUnsubToken : "";
    if (!expected || expected !== token) {
        return NextResponse.redirect("https://kloner.app/settings?tab=notifications&unsub=invalid", 302);
    }

    await ref.set(
        {
            notificationPrefs: {
                journeyEmails: false,
                productEmails: false,
                securityEmails: true,
            },
            notificationPrefsUpdatedAt: Date.now(),
            notificationUnsubbedAt: Date.now(),
        },
        { merge: true },
    );

    return NextResponse.redirect("https://kloner.app/settings?tab=notifications&unsub=ok", 302);
}
