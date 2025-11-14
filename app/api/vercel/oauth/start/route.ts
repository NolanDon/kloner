// app/api/vercel/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySession, getAdminDb } from "../../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    // If there is no session cookie at all, don’t even try to verify.
    const hasSessionCookie = Boolean(req.cookies.get("__session")?.value);
    if (!hasSessionCookie) {
        // Anonymous / not logged in → treat as disconnected, no error log.
        return NextResponse.json({ connected: false }, { status: 200 });
    }

    const db = getAdminDb();

    try {
        const decoded = await verifySession(req);
        const uid = decoded.uid as string;

        const ref = db
            .collection("kloner_users")
            .doc(uid)
            .collection("integrations")
            .doc("vercel");

        const snap = await ref.get();

        if (!snap.exists) {
            return NextResponse.json({ connected: false }, { status: 200 });
        }

        const data = snap.data() || {};
        const connected = Boolean((data as any).connected);

        return NextResponse.json({ connected }, { status: 200 });
    } catch (err: any) {
        // If verifySession says 401, just treat as disconnected, don’t spam the console.
        if (err && typeof err.status === "number" && err.status === 401) {
            return NextResponse.json({ connected: false }, { status: 200 });
        }

        console.error("[vercel-status] unexpected error", err);
        return NextResponse.json({ connected: false }, { status: 200 });
    }
}
