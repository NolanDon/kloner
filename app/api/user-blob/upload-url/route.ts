// app/api/user-blob/upload-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "edge"; // or "nodejs", whatever you're using

export async function POST(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const filename = searchParams.get("filename") || "upload.bin";

        const contentType =
            req.headers.get("content-type") || "application/octet-stream";
        const body = await req.arrayBuffer();

        // IMPORTANT: addRandomSuffix to avoid "blob already exists"
        const { url } = await put(filename, body, {
            access: "public",
            contentType,
            addRandomSuffix: true, // <--- key line
            // allowOverwrite: false, // default
        });

        return NextResponse.json({ url });
    } catch (err: any) {
        console.error("user-blob upload error", err);
        return NextResponse.json(
            { error: err?.message || "upload_failed" },
            { status: 500 }
        );
    }
}
