import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(value: any): string | null {
    if (!value) return null;
    if (typeof value === "string") {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (typeof value?.toDate === "function") {
        return value.toDate().toISOString();
    }
    if (typeof value === "object" && typeof value._seconds === "number") {
        return new Date(value._seconds * 1000).toISOString();
    }
    return null;
}

function serializeEvent(id: string, raw: any) {
    return {
        id,
        ...raw,
        createdAt: toIso(raw?.createdAt),
        occurredAt: toIso(raw?.occurredAt) || raw?.occurredAt || null,
    };
}

function asInt(value: string | null, fallback: number): number {
    const n = Number.parseInt(value || "", 10);
    if (!Number.isFinite(n)) return fallback;
    return n;
}

function normalizeLimit(raw: string | null): number {
    const n = asInt(raw, 50);
    if (n < 1) return 1;
    if (n > 200) return 200;
    return n;
}

function parseCursor(raw: string | null): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const db = getAdminDb();
            const user = await admin.auth().getUser(uid);
            const isAdmin = user.customClaims?.admin === true;

            if (!isAdmin) {
                return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
            }

            const url = req.nextUrl;
            const eventId = (url.searchParams.get("event") || "").trim();
            if (eventId) {
                const doc = await db.collection("observability_events").doc(eventId).get();
                if (!doc.exists) {
                    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
                }
                return NextResponse.json({ ok: true, event: serializeEvent(doc.id, doc.data() || {}) });
            }

            const limit = normalizeLimit(url.searchParams.get("limit"));
            const source = (url.searchParams.get("source") || "").trim();
            const severity = (url.searchParams.get("severity") || "").trim();
            const statusClass = (url.searchParams.get("statusClass") || "").trim();
            const service = (url.searchParams.get("service") || "").trim();
            const cursor = parseCursor(url.searchParams.get("cursor"));

            let query: FirebaseFirestore.Query = db
                .collection("observability_events")
                .orderBy("createdAt", "desc")
                .limit(Math.max(limit * 4, 120));

            if (cursor) {
                query = query.where("createdAt", "<", cursor);
            }

            const snap = await query.get();
            const events = snap.docs
                .map((doc) => serializeEvent(doc.id, doc.data() || {}))
                .filter((event: any) => {
                    if (source && event.source !== source) return false;
                    if (severity && event.severity !== severity) return false;
                    if (service && event.service !== service) return false;

                    const status = typeof event.statusCode === "number" ? event.statusCode : null;
                    if (statusClass === "4xx" && !(status && status >= 400 && status < 500)) return false;
                    if (statusClass === "5xx" && !(status && status >= 500 && status < 600)) return false;

                    return true;
                })
                .slice(0, limit);
            const nextCursor = events.length ? events[events.length - 1]?.createdAt || null : null;

            return NextResponse.json({
                ok: true,
                count: events.length,
                nextCursor,
                events,
            });
        },
        { methods: ["GET"] },
    );
}
