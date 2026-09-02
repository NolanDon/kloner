import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminAuth, getAdminDb } from "../../_lib/auth";
import { captureCriticalEvent } from "@/lib/observability";
import {
  restoreUserLiveSites,
  sendSiteAccessSuspendedEmail,
  suspendUserLiveSites,
} from "../../_lib/subscriptionSiteAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = getAdminDb();
  const now = new Date();
  const snap = await db.collection("billing_site_access_jobs").get();
  const jobs = snap.docs.filter((doc) => {
    const data = doc.data() as any;
    const next = data.nextAttemptAt?.toDate?.() || data.nextAttemptAt;
    return ["queued", "retry"].includes(data.status) && (!next || new Date(next).getTime() <= now.getTime());
  }).slice(0, 25);
  const results: Array<Record<string, unknown>> = [];

  for (const doc of jobs) {
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const data = fresh.data() as any;
      if (!fresh.exists || !["queued", "retry"].includes(data?.status)) return false;
      tx.update(doc.ref, { status: "processing", startedAt: new Date(), updatedAt: new Date() });
      return true;
    });
    if (!claimed) continue;

    const data = doc.data() as any;
    try {
      if (data.operation === "suspend") {
        const result = await suspendUserLiveSites(data.uid, data.reason || "subscription_cancelled");
        const authUser = await getAdminAuth().getUser(data.uid).catch(() => null);
        if (authUser?.email && result.suspended > 0) {
          await sendSiteAccessSuspendedEmail({ uid: data.uid, email: authUser.email, name: authUser.displayName || null, reason: data.reason || "subscription_cancelled" });
        }
        results.push({ uid: data.uid, operation: data.operation, ...result });
      } else if (data.operation === "restore") {
        results.push({ uid: data.uid, operation: data.operation, ...(await restoreUserLiveSites(data.uid)) });
      } else {
        throw new Error("Unknown billing site access operation");
      }
      await doc.ref.update({ status: "completed", completedAt: new Date(), updatedAt: new Date(), error: admin.firestore.FieldValue.delete() });
    } catch (error: any) {
      const attempts = Number(data.attempts || 0) + 1;
      const terminal = attempts >= 8;
      const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.min(attempts, 10) * 1000);
      await doc.ref.update({ status: terminal ? "failed" : "retry", attempts, nextAttemptAt: new Date(Date.now() + delayMs), error: String(error?.message || error), updatedAt: new Date() });
      await captureCriticalEvent({
        source: "vercel",
        severity: "critical",
        alwaysNotifySlack: true,
        statusCode: 500,
        route: "/api/private/process-billing-site-access",
        method: "POST",
        action: "billing.siteAccess.job_failed",
        service: "billing-site-access-worker",
        userId: data.uid,
        message: String(error?.message || error || "Billing site access job failed"),
        extra: { operation: data.operation, attempts, terminal },
      }).catch(() => undefined);
      results.push({ uid: data.uid, operation: data.operation, ok: false, attempts, terminal });
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(req: NextRequest) { return POST(req); }
