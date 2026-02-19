// app/api/vercel/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    // If there is no session cookie at all, don’t even try to verify.
    const hasSessionCookie = Boolean(req.cookies.get("__session")?.value);
    if (!hasSessionCookie) {
        // Anonymous / not logged in → treat as disconnected, no error log.
        return NextResponse.json({ connected: false }, { status: 200 });
    }

    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const db = getAdminDb();

            const ref = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("vercel");

            const snap = await ref.get();

            if (!snap.exists) {
                return NextResponse.json(
                    {
                        connected: false,
                        uid,
                        exists: false,
                        reason: "no_integration_doc",
                    },
                    { status: 200 },
                );
            }

            const data = snap.data() || {};
            const connected = Boolean((data as any).connected);

            return NextResponse.json(
                {
                    connected,
                    uid,
                    exists: true,
                    reason: connected ? "connected_true" : "connected_false",
                },
                { status: 200 },
            );
        },
        {
            methods: ["GET"],
            csrf: false, // read-only, no CSRF needed
        }
    );
}
