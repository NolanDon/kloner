// app/api/admin/users/search/route.ts
import { NextResponse } from "next/server";
import admin from "firebase-admin";

function getAdmin() {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
            }),
        });
    }
    return admin;
}

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace("Bearer ", "");
        if (!token) return NextResponse.json({ ok: false }, { status: 401 });

        const adminSdk = getAdmin();
        const decoded = await adminSdk.auth().verifyIdToken(token);
        if (!(decoded as any)?.admin) {
            return NextResponse.json({ ok: false }, { status: 403 });
        }

        const q = new URL(req.url).searchParams.get("q")?.toLowerCase() || "";
        if (q.length < 2) return NextResponse.json({ ok: true, users: [] });

        // Firebase Auth does NOT support partial email search.
        // We must page users and filter.
        const users: any[] = [];
        let nextPageToken: string | undefined;

        do {
            const res = await adminSdk.auth().listUsers(1000, nextPageToken);
            for (const u of res.users) {
                if (u.email?.toLowerCase().includes(q)) {
                    users.push({
                        uid: u.uid,
                        email: u.email,
                        displayName: u.displayName || null,
                    });
                }
                if (users.length >= 8) break;
            }
            nextPageToken = res.pageToken;
        } while (nextPageToken && users.length < 8);

        return NextResponse.json({ ok: true, users });
    } catch (e: any) {
        return NextResponse.json(
            { ok: false, error: e.message },
            { status: 500 },
        );
    }
}
