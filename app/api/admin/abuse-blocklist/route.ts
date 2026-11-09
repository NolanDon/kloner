import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getAdminDb, requireAdmin } from "@/app/api/_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELD_BY_TYPE = {
    cardFingerprint: "cardFingerprints",
    cardCountry: "cardCountries",
    name: "names",
    email: "emails",
} as const;

type RuleType = keyof typeof FIELD_BY_TYPE;

function normalizeValue(type: RuleType, value: string): string {
    const trimmed = value.trim();
    if (type === "email") return trimmed.toLowerCase();
    if (type === "cardCountry") return trimmed.toUpperCase();
    if (type === "name") return trimmed.replace(/\s+/g, " ");
    return trimmed;
}

function validType(value: unknown): value is RuleType {
    return typeof value === "string" && Object.hasOwn(FIELD_BY_TYPE, value);
}

function validateValue(type: RuleType, value: unknown): string {
    if (typeof value !== "string") throw new Error("Enter a value to block.");
    const clean = normalizeValue(type, value);
    if (!clean || clean.length > 320 || /[\u0000-\u001f\u007f]/.test(clean)) {
        throw new Error("Enter a valid value (maximum 320 characters).");
    }
    if (type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
        throw new Error("Enter a valid email address.");
    }
    if (type === "cardCountry" && !/^[A-Z]{2}$/.test(clean)) {
        throw new Error("Enter a two-letter country code, such as MA.");
    }
    if (type === "cardFingerprint" && !/^[A-Za-z0-9_-]{8,128}$/.test(clean)) {
        throw new Error("Enter a valid Stripe card fingerprint.");
    }
    return clean;
}

function configRows(config: Record<string, unknown>) {
    const rows: Array<{ id: string; type: RuleType; value: string; source: "config" | "entry"; updatedAtMs: number | null }> = [];
    for (const [type, field] of Object.entries(FIELD_BY_TYPE) as Array<[RuleType, typeof FIELD_BY_TYPE[RuleType]]>) {
        const values = Array.isArray(config[field]) ? config[field] as unknown[] : [];
        for (const raw of values) {
            if (typeof raw !== "string" || !raw.trim()) continue;
            const value = normalizeValue(type, raw);
            rows.push({
                id: `config:${type}:${encodeURIComponent(value)}`,
                type,
                value,
                source: "entry",
                updatedAtMs: typeof config.updatedAt === "number" ? config.updatedAt : null,
            });
        }
    }
    return rows;
}

function unauthorized() {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
}

export async function GET(req: NextRequest) {
    const gate = await requireAdmin(req);
    if (!gate.ok) return unauthorized();

    try {
        const db = getAdminDb();
        const collection = db.collection("abuseBlocklist");
        const [configSnap, entriesSnap] = await Promise.all([
            collection.doc("config").get(),
            collection.get(),
        ]);
        const config = configSnap.exists ? configSnap.data() as Record<string, unknown> : {};
        const rows = configRows(config);

        for (const doc of entriesSnap.docs) {
            if (doc.id === "config") continue;
            const data = doc.data() as Record<string, unknown>;
            if (data.enabled === false || !validType(data.type) || typeof data.value !== "string") continue;
            const updatedAt = data.updatedAt;
            rows.push({
                id: doc.id,
                type: data.type,
                value: normalizeValue(data.type, data.value),
                source: "config",
                updatedAtMs: typeof updatedAt === "number" ? updatedAt : null,
            });
        }

        rows.sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
        return NextResponse.json({ ok: true, entries: rows });
    } catch {
        return NextResponse.json({ ok: false, error: "Could not load the abuse blocklist." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const gate = await requireAdmin(req);
    if (!gate.ok) return unauthorized();

    try {
        const body = await req.json().catch(() => ({}));
        if (!validType(body?.type)) return NextResponse.json({ ok: false, error: "Choose a valid block type." }, { status: 400 });
        const type = body.type;
        let value: string;
        try {
            value = validateValue(type, body.value);
        } catch (error) {
            return NextResponse.json({ ok: false, error: String((error as Error)?.message || "Invalid value") }, { status: 400 });
        }

        const digest = crypto.createHash("sha256").update(`${type}:${value}`).digest("hex");
        const docId = `rule_${digest}`;
        const now = Date.now();
        await getAdminDb().collection("abuseBlocklist").doc(docId).set({
            type,
            value,
            enabled: true,
            createdAt: now,
            updatedAt: now,
            updatedBy: gate.uid,
        }, { merge: true });
        return NextResponse.json({ ok: true, id: docId });
    } catch {
        return NextResponse.json({ ok: false, error: "Could not add the blocklist rule." }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const gate = await requireAdmin(req);
    if (!gate.ok) return unauthorized();

    try {
        const body = await req.json().catch(() => ({}));
        const db = getAdminDb();

        if (body?.source === "config" && validType(body?.type)) {
            let value: string;
            try {
                value = validateValue(body.type, body.value);
            } catch (error) {
                return NextResponse.json({ ok: false, error: String((error as Error)?.message || "Invalid value") }, { status: 400 });
            }
            const configRef = db.collection("abuseBlocklist").doc("config");
            await db.runTransaction(async (tx) => {
                const snapshot = await tx.get(configRef);
                if (!snapshot.exists) throw new Error("Rule not found");
                const data = snapshot.data() || {};
                const field = FIELD_BY_TYPE[body.type as RuleType];
                const current = Array.isArray(data[field]) ? data[field] as unknown[] : [];
                const next = current.filter((item) => typeof item !== "string" || normalizeValue(body.type, item) !== value);
                if (next.length === current.length) throw new Error("Rule not found");
                tx.set(configRef, { [field]: next, updatedAt: Date.now() }, { merge: true });
            });
            return NextResponse.json({ ok: true });
        }

        const id = typeof body?.id === "string" ? body.id : "";
        if (!/^rule_[a-f0-9]{64}$/.test(id)) {
            return NextResponse.json({ ok: false, error: "Invalid blocklist entry." }, { status: 400 });
        }
        await db.collection("abuseBlocklist").doc(id).delete();
        return NextResponse.json({ ok: true });
    } catch (error) {
        const message = String((error as Error)?.message || "");
        return NextResponse.json({ ok: false, error: message === "Rule not found" ? message : "Could not remove the blocklist rule." }, { status: message === "Rule not found" ? 404 : 500 });
    }
}
