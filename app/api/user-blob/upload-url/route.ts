// /app/api/user-blob/upload-url/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    const token = req.cookies.get("vercel_access")?.value;
    if (!token) return NextResponse.json({ error: "Please connect your account to Vercel before deploying." }, { status: 401 });

    const { filename, contentType, teamId } = await req.json().catch(() => ({}));
    if (!filename || typeof filename !== "string") return NextResponse.json({ error: "bad_filename" }, { status: 400 });
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(String(contentType || ""))) {
        return NextResponse.json({ error: "bad_type" }, { status: 415 });
    }

    // Ask Vercel for a one-time upload URL scoped to user's account/team.
    // Endpoint is stable: POST /v2/blob/upload-url
    const api = new URL("https://api.vercel.com/v2/blob/upload-url");
    if (teamId) api.searchParams.set("teamId", teamId);

    const r = await fetch(api, {
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            filename, // server will sanitize
            contentType,
            // Optional: add access: "public" | "private", addExpires: seconds
        }),
    });
    const j = await r.json();
    if (!r.ok || !j?.uploadUrl) return NextResponse.json({ error: j?.error?.message || "failed_to_create_upload_url" }, { status: 400 });

    // Return signed URL; client PUTs bytes directly to Vercel; server never sees the file.
    return NextResponse.json({ uploadUrl: j.uploadUrl, url: j.url }, { status: 200 });
}
