// app/api/affiliate/me/route.ts
import { NextResponse } from "next/server";
import admin from "firebase-admin";
import Stripe from "stripe";
import { initAdmin } from "../../_lib/auth";

function getAdminApp() {
    initAdmin();
    return admin.app();
}

function tryGetStripe(): Stripe | null {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    try {
        return new Stripe(key, { apiVersion: "2025-10-29.clover" });
    } catch {
        return null;
    }
}

function pickBearer(req: Request): string | null {
    const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}

async function requireUser(req: Request) {
    const token = pickBearer(req);
    if (!token) return null;
    getAdminApp();
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded;
}

function cleanStr(v: unknown, max = 256) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function num(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function toMillis(v: any): number | null {
    if (!v) return null;
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v?.toDate === "function") return v.toDate().getTime();
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : null;
    }
    return null;
}

function secToMs(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n * 1000) : null;
}

const PAID_OUT_STATUSES = new Set(["paid_out", "paidout", "affiliate_paid", "settled"]);
const CANCELED_LEDGER_STATUSES = new Set(["canceled", "cancelled"]);
const REFUND_LEDGER_STATUSES = new Set(["refunded", "void"]);

type Entry = {
    id: string;
    uid: string;
    status: string;
    payoutHold: boolean;
    commissionCents: number;
    commissionRate: number;
    netCollectedCents: number;
    createdAtMs: number | null;
    eligibleAtMs: number | null;
    paidAtMs: number | null;
    invoiceId: string;
    invoiceNumber: string;
    subscriptionId: string;
    customerId: string;
    currency: string;

    stripeSubscriptionStatus?: string | null;
    stripeCancelAtPeriodEnd?: boolean;
    stripeCanceledAtMs?: number | null;
    stripeCurrentPeriodEndMs?: number | null;
    stripeSubscribedSinceMs?: number | null;

    stripeInvoiceStatus?: string | null;
    stripeInvoiceVoided?: boolean;
    stripeRefunded?: boolean;
    stripeAmountRefundedCents?: number | null;
};

type StripeSubSlim = {
    id: string;
    status: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAtMs: number | null;
    currentPeriodEndMs: number | null;
    subscribedSinceMs: number | null;
};

type StripeInvoiceSlim = {
    id: string;
    status: string | null;
    voided: boolean;
    refunded: boolean;
    amountRefundedCents: number;
};

function isPaidOutStatus(status: string): boolean {
    const st = String(status || "").toLowerCase();
    return PAID_OUT_STATUSES.has(st);
}
function isLedgerRefundLike(status: string): boolean {
    const st = String(status || "").toLowerCase();
    return REFUND_LEDGER_STATUSES.has(st);
}
function isLedgerCanceledLike(status: string): boolean {
    const st = String(status || "").toLowerCase();
    return CANCELED_LEDGER_STATUSES.has(st);
}
function isStripeCanceledLike(s: StripeSubSlim | null): boolean {
    if (!s?.status) return false;
    const st = String(s.status).toLowerCase();
    return st === "canceled" || st === "incomplete_expired" || st === "unpaid";
}

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;

    const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
        while (true) {
            const idx = i++;
            if (idx >= items.length) break;
            out[idx] = await fn(items[idx]);
        }
    });

    await Promise.all(workers);
    return out;
}

export async function GET(req: Request) {
    try {
        const decoded = await requireUser(req);
        if (!decoded?.uid) {
            return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
        }

        const app = getAdminApp();
        const db = app.firestore();
        const uid = decoded.uid;

        const codeSnap = await db.collection("affiliate_codes").where("uid", "==", uid).limit(1).get();

        if (codeSnap.empty) {
            return NextResponse.json(
                { ok: true, hasCode: false, codeRow: null, stats: null, referralStarts: [], series: [] },
                { status: 200 }
            );
        }

        const codeDoc = codeSnap.docs[0]!;
        const codeData = codeDoc.data() as any;
        const code = cleanStr(codeData.code || codeDoc.id).toUpperCase();

        const codeRow = {
            code,
            uid: typeof codeData.uid === "string" ? codeData.uid : null,
            status: cleanStr(codeData.status || "active"),
            createdAtMs: toMillis(codeData.createdAt),
            updatedAtMs: toMillis(codeData.updatedAt),
        };

        const entriesSnap = await db
            .collection("affiliate_ledger")
            .doc(code)
            .collection("entries")
            .orderBy("createdAt", "desc")
            .limit(2000)
            .get();

        const entries: Entry[] = entriesSnap.docs.map((d) => {
            const x = d.data() as any;
            return {
                id: d.id,
                uid: typeof x.uid === "string" ? x.uid : "",
                status: cleanStr(x.status || "pending"),
                payoutHold: !!x.payoutHold,
                commissionCents: num(x.commissionCents),
                commissionRate: num(x.commissionRate),
                netCollectedCents: num(x.netCollectedCents),
                createdAtMs: toMillis(x.createdAt),
                eligibleAtMs: toMillis(x.eligibleAt),
                paidAtMs: toMillis(x.paidAt),
                invoiceId: cleanStr(x.invoiceId || d.id),
                invoiceNumber: cleanStr(x.invoiceNumber || ""),
                subscriptionId: cleanStr(x.subscriptionId || ""),
                customerId: cleanStr(x.customerId || ""),
                currency: cleanStr(x.currency || "usd"),

                stripeSubscriptionStatus: typeof x.stripeSubscriptionStatus === "string" ? x.stripeSubscriptionStatus : null,
                stripeCancelAtPeriodEnd: !!x.stripeCancelAtPeriodEnd,
                stripeCanceledAtMs: toMillis(x.stripeCanceledAtMs),
                stripeCurrentPeriodEndMs: toMillis(x.stripeCurrentPeriodEndMs),
                stripeSubscribedSinceMs: toMillis(x.stripeSubscribedSinceMs),

                stripeInvoiceStatus: typeof x.stripeInvoiceStatus === "string" ? x.stripeInvoiceStatus : null,
                stripeInvoiceVoided: !!x.stripeInvoiceVoided,
                stripeRefunded: !!x.stripeRefunded,
                stripeAmountRefundedCents:
                    typeof x.stripeAmountRefundedCents === "number" && Number.isFinite(x.stripeAmountRefundedCents)
                        ? x.stripeAmountRefundedCents
                        : null,
            };
        });

        const byUid = new Map<string, Entry[]>();
        for (const e of entries) {
            if (!e.uid) continue;
            const arr = byUid.get(e.uid) || [];
            arr.push(e);
            byUid.set(e.uid, arr);
        }

        const stripe = tryGetStripe();

        const subIds = Array.from(
            new Set(entries.map((e) => e.subscriptionId).filter((s) => typeof s === "string" && s.startsWith("sub_")))
        );
        const invoiceIds = Array.from(
            new Set(entries.map((e) => e.invoiceId).filter((s) => typeof s === "string" && s.startsWith("in_")))
        );

        const subMap = new Map<string, StripeSubSlim | null>();
        const invMap = new Map<string, StripeInvoiceSlim | null>();

        if (stripe) {
            if (subIds.length) {
                const pairs = await mapWithConcurrency(subIds, 6, async (subId): Promise<[string, StripeSubSlim | null]> => {
                    try {
                        const s = await stripe.subscriptions.retrieve(subId);
                        const status = (s as any)?.status ? String((s as any).status) : null;
                        const cancelAtPeriodEnd = !!(s as any)?.cancel_at_period_end;
                        const canceledAtMs = secToMs((s as any)?.canceled_at);
                        const currentPeriodEndMs = secToMs((s as any)?.current_period_end);
                        const startDateMs = secToMs((s as any)?.start_date);
                        const createdMs = secToMs((s as any)?.created);
                        const subscribedSinceMs = startDateMs ?? createdMs ?? null;
                        return [subId, { id: subId, status, cancelAtPeriodEnd, canceledAtMs, currentPeriodEndMs, subscribedSinceMs }];
                    } catch {
                        return [subId, null];
                    }
                });
                for (const [k, v] of pairs) subMap.set(k, v);
            }

            if (invoiceIds.length) {
                const pairs = await mapWithConcurrency(
                    invoiceIds,
                    6,
                    async (invoiceId): Promise<[string, StripeInvoiceSlim | null]> => {
                        try {
                            const inv = await stripe.invoices.retrieve(invoiceId, { expand: ["payment_intent", "charge"] });
                            const invAny = inv as any;

                            const invStatus = invAny?.status ? String(invAny.status) : null;
                            const voided = invStatus === "void";

                            let refunded = false;
                            let amountRefundedCents = 0;

                            const pi = invAny?.payment_intent as any;
                            if (pi?.charges?.data?.length) {
                                const ch = pi.charges.data[0];
                                const ar = Number(ch?.amount_refunded || 0);
                                amountRefundedCents = Number.isFinite(ar) ? ar : 0;
                                refunded = !!ch?.refunded || amountRefundedCents > 0;
                            } else {
                                const ch = invAny?.charge as any;
                                if (ch) {
                                    const ar = Number(ch?.amount_refunded || 0);
                                    amountRefundedCents = Number.isFinite(ar) ? ar : 0;
                                    refunded = !!ch?.refunded || amountRefundedCents > 0;
                                }
                            }

                            if (voided) {
                                refunded = true;
                                const paid = typeof invAny?.amount_paid === "number" ? invAny.amount_paid : 0;
                                if (amountRefundedCents === 0) amountRefundedCents = paid;
                            }

                            return [invoiceId, { id: invoiceId, status: invStatus, voided, refunded, amountRefundedCents }];
                        } catch {
                            return [invoiceId, null];
                        }
                    }
                );
                for (const [k, v] of pairs) invMap.set(k, v);
            }
        }

        const isRefundLikeEntry = (e: Entry): boolean => {
            const inv = e.invoiceId ? invMap.get(e.invoiceId) : null;
            if (inv?.refunded || inv?.voided) return true;
            if (e.stripeRefunded || e.stripeInvoiceVoided) return true;
            if (isLedgerRefundLike(e.status)) return true;
            return false;
        };

        const isCanceledLikeEntry = (e: Entry): boolean => {
            const sub = e.subscriptionId ? subMap.get(e.subscriptionId) : null;
            if (isStripeCanceledLike(sub || null)) return true;
            if (e.stripeSubscriptionStatus && String(e.stripeSubscriptionStatus).toLowerCase() === "canceled") return true;
            if (isLedgerCanceledLike(e.status)) return true;
            return false;
        };

        const isPendingCommissionEntry = (e: Entry): boolean => {
            if (isPaidOutStatus(e.status)) return false;
            if (e.payoutHold) return false;
            if (isRefundLikeEntry(e)) return false;
            if (isCanceledLikeEntry(e)) return false;
            return true;
        };

        // totals
        const totalEarnedCents = entries
            .filter((e) => isPaidOutStatus(e.status))
            .reduce((s, e) => s + e.commissionCents, 0);

        const pendingCents = entries
            .filter(isPendingCommissionEntry)
            .reduce((s, e) => s + e.commissionCents, 0);

        const nextEligibleAtMs = (() => {
            let min: number | null = null;
            for (const e of entries) {
                if (!isPendingCommissionEntry(e)) continue;
                if (!e.eligibleAtMs) continue;
                if (min === null || e.eligibleAtMs < min) min = e.eligibleAtMs;
            }
            return min;
        })();

        const referralsCount = byUid.size;

        // health rollups + subscribedSince (min across referred subs)
        const canceledUidSet = new Set<string>();
        const refundedUidSet = new Set<string>();
        let subscribedSinceMin: number | null = null;

        // build de-identified “subscription starts” for chart (one per referred uid)
        const referralStarts: Array<{
            startedAtMs: number;
            status: "active" | "canceled" | "refunded";
            canceledAtMs: number | null;
        }> = [];

        for (const [rid, arr] of byUid.entries()) {
            const anyRefunded = arr.some(isRefundLikeEntry);
            const anyCanceled = arr.some(isCanceledLikeEntry);

            const status: "active" | "canceled" | "refunded" =
                anyRefunded ? "refunded" : anyCanceled ? "canceled" : "active";

            if (anyRefunded) refundedUidSet.add(rid);
            if (!anyRefunded && anyCanceled) canceledUidSet.add(rid);

            // earliest subscribedSince for that uid
            let since: number | null = null;
            let canceledAt: number | null = null;

            for (const e of arr) {
                const sub = e.subscriptionId ? subMap.get(e.subscriptionId) : null;
                const sSince = sub?.subscribedSinceMs ?? e.stripeSubscribedSinceMs ?? null;
                if (typeof sSince === "number") {
                    if (since === null || sSince < since) since = sSince;
                }

                const sCanceled = sub?.canceledAtMs ?? e.stripeCanceledAtMs ?? null;
                if (typeof sCanceled === "number") {
                    if (canceledAt === null || sCanceled < canceledAt) canceledAt = sCanceled;
                }
            }

            // fallback: earliest ledger createdAt if Stripe start missing
            if (since === null) {
                const createdList = arr.map((e) => e.createdAtMs).filter((v): v is number => typeof v === "number");
                if (createdList.length) since = Math.min(...createdList);
            }

            if (typeof since === "number") {
                referralStarts.push({ startedAtMs: since, status, canceledAtMs: canceledAt });
                if (subscribedSinceMin === null || since < subscribedSinceMin) subscribedSinceMin = since;
            }
        }

        const canceledCount = canceledUidSet.size;
        const overallHealthStatus =
            refundedUidSet.size > 0 ? "refunded" : canceledUidSet.size > 0 ? "canceled" : referralsCount > 0 ? "active" : "—";

        // pre-bucket daily series for up to 365 days (client filters slice)
        const seriesMap = new Map<string, { date: string; active: number; canceled: number; refunded: number; total: number }>();
        for (const r of referralStarts) {
            const d = new Date(r.startedAtMs);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            const key = `${yyyy}-${mm}-${dd}`;
            const cur = seriesMap.get(key) || { date: key, active: 0, canceled: 0, refunded: 0, total: 0 };
            cur.total += 1;
            if (r.status === "active") cur.active += 1;
            if (r.status === "canceled") cur.canceled += 1;
            if (r.status === "refunded") cur.refunded += 1;
            seriesMap.set(key, cur);
        }

        const series = Array.from(seriesMap.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        return NextResponse.json(
            {
                ok: true,
                hasCode: true,
                codeRow,
                stats: {
                    code,
                    totalEarnedCents,
                    pendingCents,
                    nextPayoutAtMs: nextEligibleAtMs,
                    referralsCount,
                    canceledCount,
                    subscribedSinceMs: subscribedSinceMin,
                    overallHealthStatus,
                },
                // no member identifiers
                referralStarts,
                series,
            },
            { status: 200 }
        );
    } catch (e: any) {
        return NextResponse.json(
            { ok: false, error: String(e?.message || "Failed to load affiliate dashboard") },
            { status: 500 }
        );
    }
}
