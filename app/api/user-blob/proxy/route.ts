// app/api/user-blob/proxy/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const firebaseUrl = searchParams.get("url");

        if (!firebaseUrl) {
            return NextResponse.json(
                { error: "Missing url parameter" },
                { status: 400 }
            );
        }

        // Validate that it's a Firebase Storage URL to prevent abuse
        if (!firebaseUrl.startsWith("https://firebasestorage.googleapis.com/")) {
            return NextResponse.json(
                { error: "Invalid URL" },
                { status: 400 }
            );
        }

        // Fetch the image from Firebase Storage
        const response = await fetch(firebaseUrl);

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch image" },
                { status: response.status }
            );
        }

        // Get the image data
        const imageBuffer = await response.arrayBuffer();

        // Create response with proper CORS headers
        const proxyResponse = new NextResponse(imageBuffer, {
            status: 200,
            headers: {
                "Content-Type": response.headers.get("content-type") || "image/jpeg",
                "Cache-Control": response.headers.get("cache-control") || "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });

        return proxyResponse;
    } catch (err: any) {
        console.error("Image proxy error:", err);
        return NextResponse.json(
            { error: err?.message || "proxy_failed" },
            { status: 500 }
        );
    }
}