import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';
import { assertAppBuilderScope } from '../_lib/appBuilderScope';
import { getAdminDb } from '../_lib/auth';
import { normalizePreviewRuntimeEvidence } from '@/src/lib/previewRuntimeEvidence';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
    const text = await req.text();
    if (Buffer.byteLength(text) > 64_000) return NextResponse.json({ error: 'Evidence too large' }, { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid evidence' }, { status: 400 });
    const appId = String(body.appId || ''), code = String(body.code || '');
    const evidence = normalizePreviewRuntimeEvidence(body.runtime);
    if (!/^[\w-]{1,180}$/.test(appId) || !/^[\w-]{1,180}$/.test(code) || !evidence) return NextResponse.json({ error: 'Invalid evidence' }, { status: 400 });
    assertAppBuilderScope(req, uid, appId);
    const now = Date.now();
    const expectedHost = (process.env.NEXT_PUBLIC_PREVIEW_HOST || 'preview.kloner.app').trim().toLowerCase();
    let origin;
    try { origin = new URL(evidence.url).origin; } catch { /* rejected below */ }
    if (origin !== `https://${expectedHost}` || Math.abs(now - evidence.capturedAt) > 120_000 || evidence.startedAt > evidence.capturedAt) {
      return NextResponse.json({ error: 'Stale or invalid preview evidence' }, { status: 400 });
    }
    const ref = getAdminDb().collection('kloner_users').doc(uid).collection('kloner_apps').doc(appId).collection('previews').doc(code);
    const saved = await getAdminDb().runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const previous = snap.data()?.browserRuntimeEvidence;
      if (previous?.report?.startedAt > evidence.startedAt) return true;
      if (previous?.report?.navigationId === evidence.navigationId && previous.report.capturedAt >= evidence.capturedAt) return true;
      tx.update(ref, { browserRuntimeEvidence: { receivedAt: now, source: 'editor_browser_untrusted', report: evidence } });
      return true;
    });
    return NextResponse.json({ ok: saved }, { status: saved ? 200 : 404 });
  }, { csrf: true, methods: ['POST'] });
}
