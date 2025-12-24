// app/api/notifications/prefs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { verifySession, getAdminDb } from "../../_lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type Prefs = {
    journeyEmails: boolean;
    productEmails: boolean;
    securityEmails: boolean; // keep on by default in UI, but allow off if you want later
};

function normalizePrefs(input: any): Prefs {
    const safe = (v: any, fallback: boolean) =>
        typeof v === "boolean" ? v : fallback;

    return {
        journeyEmails: safe(input?.journeyEmails, true),
        productEmails: safe(input?.productEmails, false),
        securityEmails: safe(input?.securityEmails, true),
    };
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            const decoded = await verifySession(req);
            const db = getAdminDb();
            const ref = db.collection("kloner_users").doc(decoded.uid);
            const snap = await ref.get();
            const data = snap.exists ? snap.data() : null;

            const prefs = normalizePrefs(data?.notificationPrefs || {});
            return NextResponse.json(
                { ok: true, prefs },
                { headers: { "Cache-Control": "no-store" } },
            );
        },
        { methods: ["GET"], csrf: false },
    );
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            const decoded = await verifySession(req);
            const body = await req.json().catch(() => ({}));
            const prefs = normalizePrefs(body);

            const db = getAdminDb();
            const ref = db.collection("kloner_users").doc(decoded.uid);

            await ref.set(
                {
                    notificationPrefs: prefs,
                    notificationPrefsUpdatedAt: Date.now(),
                },
                { merge: true },
            );

            return NextResponse.json(
                { ok: true, prefs },
                { headers: { "Cache-Control": "no-store" } },
            );
        },
        { methods: ["POST"], csrf: true },
    );
}
