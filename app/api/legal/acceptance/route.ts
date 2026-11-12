import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/src/lib/legalVersions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set(["email", "google", "apple"]);

export async function POST(request: NextRequest) {
  return requireSessionAndMaybeCsrf(request, async ({ uid }) => {
    const body = await request.json().catch(() => ({}));
    const method = typeof body.method === "string" ? body.method.trim().toLowerCase() : "";
    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json({ ok: false, error: "Invalid signup method." }, { status: 400 });
    }

    const termsVersion = CURRENT_TERMS_VERSION;
    const privacyVersion = CURRENT_PRIVACY_VERSION;
    const id = `${uid}_${termsVersion}_${privacyVersion}`;
    const db = getAdminDb();
    const ref = db.collection("legal_acceptances").doc(id);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists) return;
      transaction.create(ref, {
        uid,
        termsVersion,
        privacyVersion,
        source: "signup",
        method,
        acceptedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true, termsVersion, privacyVersion });
  }, { csrf: true, methods: ["POST"] });
}
