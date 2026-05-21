# Compliance Implementation Backlog

Priority is aligned to the audit findings. Critical items are first, and the work should proceed in this order unless a dependency blocks it.

## Critical

1. Remove the committed internal API secret from deployment config and rotate the key in the deployment secret store.
2. Add a real Privacy Policy page, link it from signup/footer, and persist versioned policy acceptance evidence server-side.
3. Add self-serve account export and account deletion endpoints with propagation to Firebase Auth, Firestore, Storage, Stripe, Vercel, Supabase, and analytics vendors.

## High

4. Add a consent manager and gate Google Analytics, Mixpanel, and session replay on explicit consent where required.
5. Strip sensitive query strings and values from analytics events and autocapture payloads.
6. Encrypt Vercel OAuth tokens before storing them in Firestore and backfill legacy plaintext docs.
7. Move crawl SSRF protections into the backend crawler and verify destination IPs after DNS resolution and redirects.
8. Add robots.txt handling, crawl rate limits, and per-domain throttling in the backend crawler.

## Medium

9. Enforce MIME and size validation on storage uploads.
10. Add deletion auditing and documented retention windows for logs, analytics, screenshots, and backups.
11. Tighten Firestore custom-claim checks to a single typed admin/support claim format.

## Current Status

- `INTERNAL_API_KEY` removal: completed
- Privacy policy implementation: completed
- Account export/delete implementation: completed
- Vercel token migration: completed