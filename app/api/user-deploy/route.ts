// /app/api/user-deploy/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    const token = req.cookies.get("vercel_access")?.value;
    if (!token) return NextResponse.json({ error: "not_connected" }, { status: 401 });

    const { html, projectName, teamId } = await req.json().catch(() => ({}));
    if (!html || typeof html !== "string") return NextResponse.json({ error: "bad_html" }, { status: 400 });

    // Single-file deployment via Vercel REST.
    // v13 deploys accept {files:[{file,data}], name}
    const api = new URL("https://api.vercel.com/v13/deployments");
    if (teamId) api.searchParams.set("teamId", teamId);

    const payload = {
        name: projectName || "kloner-site",
        files: [
            {
                file: "index.html",
                data: Buffer.from(html, "utf8").toString("base64"),
                encoding: "base64",
            },
        ],
        // Optional: framework: "static"
        target: "production",
    };

    const r = await fetch(api, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j?.url) return NextResponse.json({ error: j?.error?.message || "deploy_failed" }, { status: 400 });

    return NextResponse.json({ url: `https://${j.url}` }, { status: 200 });
}
