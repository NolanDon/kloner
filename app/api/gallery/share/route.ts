// src/app/api/gallery/share/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type ShareBody = {
  renderId?: string;
  html?: string;
  name?: string;
  screenshotKey?: string;
  remixable?: boolean;
};

export async function POST(req: NextRequest) {
  return requireSessionAndMaybeCsrf(
    req,
    async ({ uid }) => {
      let body: ShareBody;
      try {
        body = (await req.json()) as ShareBody;
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON payload" },
          { status: 400 }
        );
      }

      const { renderId, html, name, screenshotKey, remixable } = body;

      if (!renderId || !html || !screenshotKey) {
        return NextResponse.json(
          { error: "Missing required fields" },
          { status: 400 }
        );
      }

      const safeName =
        typeof name === "string" && name.trim().length
          ? name.trim()
          : "Untitled build";

      const db = await getAdminDb();
      const docRef = db.collection("gallery").doc(renderId);

      const existing = await docRef.get();
      if (existing.exists) {
        // Already shared – don't duplicate, just report back
        return NextResponse.json(
          { ok: true, alreadyShared: true },
          { status: 200 }
        );
      }

      await docRef.set({
        sourceRenderId: renderId,
        html,
        name: safeName,
        screenshotKey,
        remixable: !!remixable,
        author: uid,
        approved: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json(
        { ok: true, alreadyShared: false },
        { status: 200 }
      );
    },
    { methods: ["POST"] }
  );
}
