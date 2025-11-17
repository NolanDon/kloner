// app/api/_lib/route-guard.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "./auth";

type GuardOpts = {
    csrf?: boolean;            // enable CSRF check
    methods?: string[];        // restrict allowed methods
};

type AuthedHandler = (args: {
    req: NextRequest;
    uid: string;
}) => Promise<NextResponse>;

export async function requireSessionAndMaybeCsrf(
    req: NextRequest,
    handler: AuthedHandler,
    opts: GuardOpts = {}
): Promise<NextResponse> {
    const { csrf = false, methods } = opts;

    if (methods && !methods.includes(req.method)) {
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
    }

    let uid: string;
    try {
        const session = await verifySession(req);
        uid = session.uid;
    } catch (err) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (csrf && req.method !== "GET" && req.method !== "HEAD") {
        const csrfCookie = req.cookies.get("csrf")?.value;
        const csrfHeader = req.headers.get("x-csrf");

        if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
            return NextResponse.json({ error: "CSRF check failed" }, { status: 403 });
        }
    }

    return handler({ req, uid });
}
