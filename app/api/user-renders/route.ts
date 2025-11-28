// app/api/user-renders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();

        // kloner_users/{uid}/kloner_renders/*
        const userDocRef = db.collection("kloner_users").doc(uid);
        const rendersCol = userDocRef.collection("kloner_renders");

        const snap = await rendersCol
            .orderBy("createdAt", "desc")
            .get();

        const renders = snap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return NextResponse.json({ ok: true, renders });
    });
}
