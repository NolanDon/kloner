import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import { getAdminDb } from "../../../_lib/auth";
export const runtime = "nodejs";
const bucket = () => getStorage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET);
const imagePath = (uid: string, appId: string, id: string) => `agent-inputs/${uid}/${appId}/${id}.webp`;
export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authed }) => {
        const { appId } = await params;
        assertAppBuilderScope(authed, uid, appId);
        if (Number(authed.headers.get("content-length") || 0) > 12 * 1024 * 1024) return NextResponse.json({ error: "Choose an image under 10 MB." }, { status: 413 });
        const app = await getAdminDb().collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).get();
        if (!app.exists) return NextResponse.json({ error: "Project not found." }, { status: 404 });
        const form = await authed.formData(); const file = form.get("image");
        if (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(file.type)) return NextResponse.json({ error: "Choose a PNG, JPEG, WebP, or AVIF image." }, { status: 400 });
        if (!file.size || file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Choose an image under 10 MB." }, { status: 413 });
        let image;
        try { image = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 25_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true }); }
        catch { return NextResponse.json({ error: "That image could not be read. Try a PNG or JPEG." }, { status: 400 }); }
        if (image.data.length > 4 * 1024 * 1024) return NextResponse.json({ error: "This image is too detailed. Try a smaller screenshot." }, { status: 413 });
        const id = randomUUID();
        await bucket().file(imagePath(uid, appId, id)).save(image.data, { resumable: false, metadata: { contentType: "image/webp", cacheControl: "private, max-age=0", metadata: { owner: uid, appId, createdAt: new Date().toISOString() } } });
        return NextResponse.json({ id, name: file.name.slice(0, 120), mimeType: "image/webp", width: image.info.width, height: image.info.height });
    });
}
export async function GET(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authed }) => {
        const { appId } = await params; assertAppBuilderScope(authed, uid, appId);
        const id = authed.nextUrl.searchParams.get("id") || "";
        if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: "Image not found." }, { status: 404 });
        try { const [bytes] = await bucket().file(imagePath(uid, appId, id)).download(); return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } }); }
        catch { return NextResponse.json({ error: "Image not found." }, { status: 404 }); }
    });
}
