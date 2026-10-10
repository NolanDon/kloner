# Checkout recovery audit — 2026-10-10

## Live findings

Read-only audit of production Stripe customers created since October 9 at 00:00 America/Edmonton (06:00 UTC), their Checkout Sessions and subscriptions, and matching Firestore account records. The screenshots say “Yesterday”; the audit covers October 9 and the available portion of October 10. Customer pagination was exhausted: 10 customers, with no further page. Each customer's session query also had no further page.

| Classification | Count | Evidence and action |
| --- | ---: | --- |
| Subscribed | 4 | Completed paid subscription checkout and a currently trialing Stripe subscription. Excluded from acquisition recovery. One trial is scheduled to cancel but is still trialing. |
| Expired subscription checkout, no recorded reminder | 4 | Unpaid expired subscription sessions, no subscription, free tier, no recovery send marker, no journey opt-out, inactivity beyond 30 minutes. Eligible for a reminder following a fresh check. |
| Expired subscription checkout, reminder recorded | 2 | Firestore contains the provider email ID and accepted-send timestamp. Excluded from repeat sends. One is also shown delivered in the supplied screenshot. |

An expired unpaid session proves checkout did not complete; it does **not** establish that a card was declined. Welcome emails are signup emails and do not establish subscription payment or recovery delivery. Full account details are kept outside Git in a local private audit artifact.

### Confirmed production blockers

1. An unauthenticated GET of the production recovery endpoint returned HTTP 500 with `CRON_SECRET is not configured`. This request did not send any emails. Scheduled authentication cannot work until the production environment variable is configured and deployed.
2. The live Stripe webhook is disabled. Both the v1 webhook endpoint list and v2 event destination list confirmed its disabled state. Its subscribed event list omits `checkout.session.expired` and `checkout.session.async_payment_failed`. Expiration events exist in Stripe, but this destination does not receive them. Restore it only after confirming that disabling it was unintentional; preserve its existing signing secret and event subscriptions.
3. The available Resend key is send-only. GET /emails returned 401 explaining this restriction. Provider delivery, bounce, complaint, and open records could not be independently audited. Stored send IDs prove API acceptance, not final delivery.
4. No recent recovery job run documents were present in Firestore. This is consistent with the missing cron secret; it does not independently prove every past execution failed.
5. `vercel.json` contained duplicate `crons` keys. Ordinary JSON parsing kept only the second, silently dropping the daily URL scan report schedule. Recovery was scheduled only once daily at 14:00 UTC, creating long delays even after setup was corrected.

## Code changes

- Consolidate cron configuration and schedule recovery every 15 minutes, preserving the daily scan report. Sub-daily scheduling requires a supporting Vercel plan; Hobby supports daily jobs only. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Persist scan progress after each account, stop after a 240-second budget, and resume on the next run. Wrapping after a full pass lets skipped and failed accounts be checked again.
- Verify actual unpaid expired subscription Checkout Sessions rather than treating every Stripe customer as an abandoned checkout. Exclude customers with a still-open subscription retry; topups alone are not recovery evidence.
- Record confirmed asynchronous subscription checkout failures so the scheduled run can recover them later. Pending asynchronous payments are not inferred to have failed. Existing subscriber and unsubscribe exclusions still apply.
- Exclude active and trialing Stripe subscriptions, including trials scheduled to cancel. Repeat local subscription and opt-out checks inside the delivery transaction.
- Freeze the complete provider request, including signed URLs and subject, and persist a shared idempotency key. Browser returns, webhooks, and scheduled retries replay that same request. Confirmations and failure state are written only by the current lease owner.
- Preserve uncertain requests for reconciliation after 23 hours to avoid resending after provider deduplication expires. Explicit known rejections remain retryable; a subsequent rejection cannot erase an earlier timeout's uncertainty. Resend retains keys for 24 hours. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
- Preserve legacy sent markers until provider records can reconcile them. Do not blindly clear them or email prior recipients again.
- Separate delivery-unavailable skips from already-sent counts. Remove an outer catch write that could overwrite a concurrent successful send.
- Personalize with a validated first name and use three stable subject variants per campaign, assigned by user ID. Save the subject and template version for later analysis. Escape email HTML and link attributes. Replies go to support@kloner.app.

Checkout subject examples:

- “Psssst, Dana — your Kloner checkout”
- “Hey Dana, did checkout get in the way?”
- “Your Kloner checkout, with a little help from me”

The message opens warmly, offers the existing 40% first-month discount, invites a reply for help, and retains unsubscribe links. It does not claim a card decline, invent a customer's name from an email address, or promise a higher open rate. Stable variants make future comparison possible once provider metrics are accessible.

## Validation and rollout

Recovery tests cover overlapping triggers, retry payload/key stability, provider acceptance followed by a database write failure, stale lease owners, subscriber and unsubscribe exclusions, canceled-but-still-active trials, ambiguous sends beyond the deduplication window, known rejections, safe personalization, genuine checkout evidence, pending asynchronous payment, and persisted scan progress.

Broader billing checks include checkout creation, credit topups, recovery links, subscription cancellation, and Stripe webhooks. Two outdated cancellation test expectations were corrected to reflect the existing transaction and provider idempotency behavior; cancellation production code was unchanged.

Validation: 68 tests across 13 billing, Stripe, journey, and recovery suites passed across the final regression run and the corrected cancellation-suite rerun. `npx tsc --noEmit` passed. `npm run build` passed, and ESLint passed for all changed TypeScript files. `git diff --check` passed.

These changes belong to the Next.js frontend repository and deploy on Vercel. The Fly backend is unchanged. No manual recovery sends, live cron invocation, subscription changes, or webhook replays were performed during the audit. Vercel configuration and deployment verification require connected Vercel access. Webhook restoration and any manual missed reminders remain pending the owner's answers.
