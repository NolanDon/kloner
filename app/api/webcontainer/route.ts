// app/api/webcontainer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callBackend } from '../../../src/lib/callBackend';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';
import { assertAppBuilderScope } from '../_lib/appBuilderScope';
import { getAdminDb } from '../_lib/auth';
import { FieldValue } from 'firebase-admin/firestore';
import crypto from 'node:crypto';

function backendConfigHint() {
  const origin = process.env.BACKEND_ORIGIN || process.env.BACKEND_URL || process.env.PUBLIC_ORIGIN || '';
  const prefix = process.env.BACKEND_PREFIX || '/api/v1';
  const hasInternalKey = Boolean(process.env.INTERNAL_API_KEY);
  return { origin, prefix, hasInternalKey };
}

function isBackendFetchFailed(resp: any) {
  return resp?.status === 502 && String(resp?.json?.error || '') === 'Backend fetch failed';
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeConfigJson(raw: string): string {
  try {
    const parsed: any = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }, null, 2) + '\n';
    }
    if (!parsed.compilerOptions || typeof parsed.compilerOptions !== 'object' || Array.isArray(parsed.compilerOptions)) {
      parsed.compilerOptions = {};
    }

    // Ensure the common @/* alias works in user apps.
    if (!parsed.compilerOptions.baseUrl || typeof parsed.compilerOptions.baseUrl !== 'string') {
      parsed.compilerOptions.baseUrl = ".";
    }
    if (!parsed.compilerOptions.paths || typeof parsed.compilerOptions.paths !== 'object' || Array.isArray(parsed.compilerOptions.paths)) {
      parsed.compilerOptions.paths = {};
    }
    if (!Array.isArray(parsed.compilerOptions.paths["@/*"])) {
      parsed.compilerOptions.paths["@/*"] = ["./*"];
    }

    return JSON.stringify(parsed, null, 2) + '\n';
  } catch {
    return JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }, null, 2) + '\n';
  }
}

function ensureNextConfigFiles(files: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...(files || {}) };

  const hasTs = typeof out['tsconfig.json']?.content === 'string';
  const hasJs = typeof out['jsconfig.json']?.content === 'string';

  if (hasTs) {
    out['tsconfig.json'] = {
      ...(out['tsconfig.json'] || {}),
      content: normalizeConfigJson(String(out['tsconfig.json']?.content || '')),
    };
  }
  if (hasJs) {
    out['jsconfig.json'] = {
      ...(out['jsconfig.json'] || {}),
      content: normalizeConfigJson(String(out['jsconfig.json']?.content || '')),
    };
  }

  // If neither exists, inject a minimal jsconfig.json so Next's dev bundler doesn't
  // crash reading compilerOptions/baseUrl.
  if (!hasTs && !hasJs) {
    out['jsconfig.json'] = { content: normalizeConfigJson('{"compilerOptions":{}}') };
  }

  return out;
}

async function handleWebcontainerPost(body: any, uid?: string) {
  const { appId, files, mode } = body || {};
  if (!appId || typeof appId !== 'string' || !files || typeof files !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const safeFiles = ensureNextConfigFiles(files as Record<string, any>);

  // Basic payload limits to reduce abuse.
  const paths = Object.keys(safeFiles);
  if (paths.length > 500) {
    return NextResponse.json({ error: 'Too many files' }, { status: 400 });
  }

  let totalBytes = 0;
  for (const p of paths) {
    const content = (safeFiles as any)[p]?.content;
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Invalid file content' }, { status: 400 });
    }
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > 10_000_000) {
      return NextResponse.json({ error: 'Files too large' }, { status: 400 });
    }
  }

  try {
    const response = await callBackend({ headers: {} } as any, {
      path: "/api/v1/webcontainer",
      method: "POST",
      body: { appId, files: safeFiles, mode },
      userCtx: uid ? { uid } : undefined,
      // Startup can legitimately take longer than the default callBackend timeout.
      timeoutMs: 45_000,
      noPrefix: true,
    });

    if (isBackendFetchFailed(response)) {
      const hint = backendConfigHint();
      console.error('[webcontainer] backend unreachable', {
        url: response.url,
        reqId: response.reqId,
        origin: hint.origin || '(unset)',
        hasInternalKey: hint.hasInternalKey,
      });
      return NextResponse.json(
        {
          error:
            process.env.NODE_ENV !== 'production'
              ? `Failed to reach the backend preview service at ${response.url}. This is usually a BACKEND_ORIGIN/BACKEND_URL misconfiguration (or the service is down).`
              : 'Failed to reach the backend preview service. This is usually a BACKEND_ORIGIN/BACKEND_URL misconfiguration (or the service is down).',
          code: 'BACKEND_UNREACHABLE',
          ...(process.env.NODE_ENV !== 'production'
            ? {
                debug: {
                  attemptedUrl: response.url,
                  requestId: response.reqId,
                  env: {
                    BACKEND_ORIGIN: hint.origin || null,
                    BACKEND_PREFIX: hint.prefix,
                    INTERNAL_API_KEY_SET: hint.hasInternalKey,
                  },
                },
              }
            : {}),
        },
        { status: 502 },
      );
    }

    if (response.status >= 400) {
      const error = response.json?.error || 'Backend error';
      const code = typeof response.json?.code === 'string' ? response.json.code : undefined;
      const reason = typeof response.json?.reason === 'string' ? response.json.reason : undefined;
      const debug = response.json?.debug;
      return NextResponse.json(
        {
          error,
          ...(code ? { code } : {}),
          ...(reason ? { reason } : {}),
          ...(debug !== undefined ? { debug } : {}),
        },
        { status: response.status },
      );
    }
    const { code } = response.json;
    return NextResponse.json({ code }); // Return code immediately
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error || '');
    console.error('Backend call error:', error);
    if (msg.includes('INTERNAL_API_KEY not set')) {
      return NextResponse.json(
        {
          error: 'Server is missing INTERNAL_API_KEY. Set it in .env.local (dev) or as a deployment secret, then restart.',
          code: 'MISSING_INTERNAL_API_KEY',
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: 'Failed to start webcontainer' }, { status: 500 });
  }
}

async function handleWebcontainerPostAuthed(body: any, uid: string) {
  const appId = String(body?.appId || '').trim();
  if (!appId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const db = getAdminDb();
  const appRef = db.collection('kloner_users').doc(uid).collection('kloner_apps').doc(appId);

  const now = Date.now();
  const lockMs = 90_000;
  const lockToken = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

  let txResult:
    | { action: 'reuse'; code: string }
    | { action: 'wait'; existingCode: string }
    | { action: 'start' };

  try {
    txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(appRef);
      if (!snap.exists) {
        throw Object.assign(new Error('App not found'), { status: 404 });
      }

      const data: any = snap.data() || {};
      const existingCode = typeof data?.containerCode === 'string' ? String(data.containerCode).trim() : '';
      const existingTs = typeof data?.containerCodeTimestamp === 'number' ? data.containerCodeTimestamp : 0;

      // If we already have a recently-issued code, reuse it.
      if (existingCode && existingTs && now - existingTs < 60_000) {
        return { action: 'reuse' as const, code: existingCode };
      }

      const lock = data?.containerStartLock;
      const expiresAt = typeof lock?.expiresAt === 'number' ? lock.expiresAt : 0;
      if (expiresAt && expiresAt > now) {
        return { action: 'wait' as const, existingCode };
      }

      tx.update(appRef, {
        containerStartLock: {
          token: lockToken,
          startedAt: now,
          expiresAt: now + lockMs,
        },
        updatedAt: new Date(),
      });

      return { action: 'start' as const };
    });
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500;
    const msg = e instanceof Error ? e.message : 'Failed to start webcontainer';
    return NextResponse.json({ error: msg }, { status });
  }

  if (txResult.action === 'reuse') {
    return NextResponse.json({ code: txResult.code });
  }

  if (txResult.action === 'wait') {
    // Another request is already starting the preview. Wait briefly for it to persist a code.
    for (let i = 0; i < 6; i++) {
      await sleep(500);
      const snap = await appRef.get();
      const data: any = snap.data() || {};
      const code = typeof data?.containerCode === 'string' ? String(data.containerCode).trim() : '';
      if (code) return NextResponse.json({ code });
    }
    return NextResponse.json(
      { error: 'Preview is already starting. Please retry in a few seconds.' },
      { status: 409 },
    );
  }

  // Start a new preview.
  const resp = await handleWebcontainerPost(body, uid);

  // Best-effort: persist the code for reconnection and clear the lock.
  try {
    const cloned = resp.clone();
    const json: any = await cloned.json().catch(() => ({} as any));
    const code = typeof json?.code === 'string' ? json.code.trim() : '';

    if (resp.ok && code) {
      await appRef.update({
        containerCode: code,
        containerCodeTimestamp: Date.now(),
        containerStartLock: FieldValue.delete(),
        updatedAt: new Date(),
      });
    } else {
      await appRef.update({
        containerStartLock: FieldValue.delete(),
        updatedAt: new Date(),
      });
    }
  } catch {
    // Ignore lock persistence failures; the preview may still start.
  }

  return resp;
}

async function handleWebcontainerStatus(code: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/status/${code}`,
      method: "GET",
      userCtx: uid ? { uid } : undefined,
      timeoutMs: 20_000,
      noPrefix: true,
    });

    if (isBackendFetchFailed(response)) {
      const hint = backendConfigHint();
      return NextResponse.json(
        {
          error:
            'Failed to reach the backend preview service while polling status. Check BACKEND_ORIGIN/BACKEND_URL.',
          code: 'BACKEND_UNREACHABLE',
          ...(process.env.NODE_ENV !== 'production'
            ? {
                debug: {
                  attemptedUrl: response.url,
                  requestId: response.reqId,
                  env: {
                    BACKEND_ORIGIN: hint.origin || null,
                    BACKEND_PREFIX: hint.prefix,
                    INTERNAL_API_KEY_SET: hint.hasInternalKey,
                  },
                },
              }
            : {}),
        },
        { status: 502 },
      );
    }

    if (response.status >= 400) {
      const error = response.json?.error || 'Backend error';
      const code = typeof response.json?.code === 'string' ? response.json.code : undefined;
      const reason = typeof response.json?.reason === 'string' ? response.json.reason : undefined;
      const debug = response.json?.debug;
      return NextResponse.json(
        {
          error,
          ...(code ? { code } : {}),
          ...(reason ? { reason } : {}),
          ...(debug !== undefined ? { debug } : {}),
        },
        { status: response.status },
      );
    }
    return NextResponse.json(response.json);
  } catch (error) {
    console.error('Backend call error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}

async function handleWebcontainerDelete(code: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/${code}`,
      method: "DELETE",
      userCtx: uid ? { uid } : undefined,
      timeoutMs: 20_000,
      noPrefix: true,
    });

    if (isBackendFetchFailed(response)) {
      const hint = backendConfigHint();
      return NextResponse.json(
        {
          error:
            'Failed to reach the backend preview service while cleaning up. Check BACKEND_ORIGIN/BACKEND_URL.',
          code: 'BACKEND_UNREACHABLE',
          ...(process.env.NODE_ENV !== 'production'
            ? {
                debug: {
                  attemptedUrl: response.url,
                  requestId: response.reqId,
                  env: {
                    BACKEND_ORIGIN: hint.origin || null,
                    BACKEND_PREFIX: hint.prefix,
                    INTERNAL_API_KEY_SET: hint.hasInternalKey,
                  },
                },
              }
            : {}),
        },
        { status: 502 },
      );
    }

    if (response.status >= 400) {
      const error = response.json?.error || 'Backend error';
      const code = typeof response.json?.code === 'string' ? response.json.code : undefined;
      const reason = typeof response.json?.reason === 'string' ? response.json.reason : undefined;
      const debug = response.json?.debug;
      return NextResponse.json(
        {
          error,
          ...(code ? { code } : {}),
          ...(reason ? { reason } : {}),
          ...(debug !== undefined ? { debug } : {}),
        },
        { status: response.status },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Backend call error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}

async function getContainerCodeForApp(uid: string, appId: string): Promise<string | null> {
  try {
    const db = getAdminDb();
    const appRef = db.collection('kloner_users').doc(uid).collection('kloner_apps').doc(appId);
    const snap = await appRef.get();
    if (!snap.exists) return null;
    const data: any = snap.data() || {};
    const code = typeof data?.containerCode === 'string' ? String(data.containerCode).trim() : '';
    return code || null;
  } catch (err) {
    console.warn('[webcontainer] Failed to resolve container code from app document', {
      appId,
      error: err instanceof Error ? err.message : String(err || 'unknown_error'),
    });
    return null;
  }
}

export async function POST(request: NextRequest) {
  console.log('WebContainer POST route hit! Method:', request.method, 'URL:', request.url);

  const internal = request.headers.get('x-kloner-internal') || '';
  const internalSecret = process.env.INTERNAL_API_SECRET || '';
  const isInternal = Boolean(internalSecret) && internal === internalSecret;

  console.log('Is internal request:', isInternal);

  if (!isInternal) {
    console.log('Processing authenticated request...');
    return requireSessionAndMaybeCsrf(
      request,
      async ({ uid, req: authedReq }) => {
        console.log('Authentication successful, UID:', uid);
        const body = await authedReq.json();
        const appId = String(body?.appId || '');
        console.log('App ID:', appId);
        assertAppBuilderScope(authedReq, uid, appId);
        return handleWebcontainerPostAuthed(body, uid);
      },
      { csrf: true, methods: ['POST'] }
    );
  }

  try {
    console.log('Processing internal request...');
    const body = await request.json();
    return await handleWebcontainerPost(body);
  } catch (error) {
    console.error('WebContainer API error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to start app';
    return NextResponse.json({ error: 'Failed to start app', logs: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 });
  }

  const internal = request.headers.get('x-kloner-internal') || '';
  const internalSecret = process.env.INTERNAL_API_SECRET || '';
  const isInternal = Boolean(internalSecret) && internal === internalSecret;

  if (!isInternal) {
    return requireSessionAndMaybeCsrf(
      request,
      async ({ uid, req: authedReq }) => {
        return handleWebcontainerStatus(code, uid);
      },
      { csrf: false, methods: ['GET'] } // Status polling doesn't need CSRF
    );
  }

  try {
    return await handleWebcontainerStatus(code);
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const queryCode = String(url.searchParams.get('code') || '').trim();
  const queryAppId = String(url.searchParams.get('appId') || '').trim();

  let code = queryCode;
  let appId = queryAppId;

  const internal = request.headers.get('x-kloner-internal') || '';
  const internalSecret = process.env.INTERNAL_API_SECRET || '';
  const isInternal = Boolean(internalSecret) && internal === internalSecret;

  if (!isInternal) {
    return requireSessionAndMaybeCsrf(
      request,
      async ({ uid, req: authedReq }) => {
        // Backward compatibility: some callers send DELETE body with appId but no code.
        if (!code || !appId) {
          const body = await authedReq.json().catch(() => ({} as any));
          if (!code) {
            code = String(body?.code || '').trim();
          }
          if (!appId) {
            appId = String(body?.appId || '').trim();
          }
        }

        if (!code && appId) {
          assertAppBuilderScope(authedReq, uid, appId);
          code = (await getContainerCodeForApp(uid, appId)) || '';
        }

        if (!code) {
          // Nothing to clean up; keep this idempotent instead of returning a noisy 400.
          return new NextResponse(null, { status: 204 });
        }

        return handleWebcontainerDelete(code, uid);
      },
      { csrf: true, methods: ['DELETE'] }
    );
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 });
  }

  try {
    return await handleWebcontainerDelete(code);
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}