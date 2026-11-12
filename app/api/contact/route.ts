import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createHmac } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../_lib/auth";
import { getClientIp } from "../_lib/route-guard";
import { captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORY_LABELS = {
  general: "General question",
  copyright: "Copyright report",
  privacy: "Privacy or data request",
  abuse: "Abuse or illegal content report",
} as const;
type ContactCategory = keyof typeof CATEGORY_LABELS;

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isCategory(value: unknown): value is ContactCategory {
  return typeof value === "string" && value in CATEGORY_LABELS;
}

async function consumeContactRateLimit(ip: string): Promise<boolean> {
  const secret = process.env.CONTACT_RATE_LIMIT_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!secret) throw new Error("Contact rate limit secret is not configured");
  const key = createHmac("sha256", secret).update(ip || "unknown").digest("hex");
  const db = getAdminDb();
  const ref = db.collection("contact_rate_limits").doc(key);
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxSubmissions = 5;

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const windowStartedAt = Number(current.windowStartedAt || 0);
    const count = windowStartedAt > 0 && now - windowStartedAt < windowMs
      ? Number(current.count || 0)
      : 0;
    if (count >= maxSubmissions) return false;

    transaction.set(ref, {
      windowStartedAt: count ? windowStartedAt : now,
      count: count + 1,
      expiresAt: new Date(now + windowMs),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function POST(request: NextRequest) {
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;

  // Quietly accept honeypot submissions without delivering or storing them.
  if (clean(body.companyWebsite, 200)) return NextResponse.json({ ok: true });

  const email = clean(body.email, 320);
  const category: ContactCategory | null = isCategory(body.category) ? body.category : null;
  const subject = clean(body.subject, 160).replace(/[\r\n]+/g, " ");
  const message = clean(body.message, 8000);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !category || message.length < 10) {
    return NextResponse.json({ ok: false, error: "Enter a valid email, report type, and message." }, { status: 400 });
  }

  try {
    const allowed = await consumeContactRateLimit(getClientIp(request));
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Too many messages. Please try again later." }, { status: 429 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
    const result = await new Resend(apiKey).emails.send({
      from: process.env.CONTACT_EMAIL_FROM || process.env.ALERT_EMAIL_FROM || "support@kloner.app",
      to: process.env.SUPPORT_TO || "support@kloner.app",
      replyTo: email,
      subject: `[Kloner ${CATEGORY_LABELS[category]}] ${subject || email}`,
      text: [
        `Category: ${CATEGORY_LABELS[category]}`,
        `Reply to: ${email}`,
        subject ? `Subject: ${subject}` : "",
        `Submitted: ${new Date().toISOString()}`,
        "",
        message,
      ].filter(Boolean).join("\n"),
    });
    if (result.error) throw new Error(result.error.message || "Email delivery failed");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await captureCriticalEvent({
      source: "vercel",
      severity: "error",
      statusCode: 502,
      route: "/api/contact",
      method: "POST",
      action: "contact.message_delivery_failed",
      service: "contact-form",
      message: error instanceof Error ? error.message : "Contact delivery failed",
      tags: ["contact", "delivery-failed"],
    }).catch(() => null);
    return NextResponse.json(
      { ok: false, error: "We couldn’t send your message. Please email support@kloner.app." },
      { status: 502 },
    );
  }
}
