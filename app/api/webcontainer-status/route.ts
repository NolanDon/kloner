// app/api/webcontainer-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callBackend } from '../../../src/lib/callBackend';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';

const DEFAULT_HUB_HOST = 'tracksite-hub.fly.dev';
const CUSTOM_PREVIEW_HOST = String(process.env.NEXT_PUBLIC_PREVIEW_HOST || 'preview.kloner.app').trim().toLowerCase();
const PREVIEW_HOST = CUSTOM_PREVIEW_HOST || DEFAULT_HUB_HOST;

type RequestDiagnostics = {
  callerType: 'browser' | 'internal-machine' | 'anonymous-script' | 'unknown';
  userAgent: string;
  origin: string;
  referer: string;
  hasSessionSignals: boolean;
};

function getRequestDiagnostics(request: NextRequest, isInternal: boolean): RequestDiagnostics {
  const userAgent = String(request.headers.get('user-agent') || '').slice(0, 300);
  const origin = String(request.headers.get('origin') || '').slice(0, 300);
  const referer = String(request.headers.get('referer') || '').slice(0, 300);
  const hasSessionSignals = Boolean(request.headers.get('cookie') || request.headers.get('authorization'));

  if (isInternal) {
    return {
      callerType: 'internal-machine',
      userAgent,
      origin,
      referer,
      hasSessionSignals,
    };
  }

  const lowerUa = userAgent.toLowerCase();
  const browserUa = /mozilla|chrome|safari|firefox|edg\//.test(lowerUa);
  const scriptUa = /curl|wget|python-requests|go-http-client|postmanruntime|okhttp|httpie/.test(lowerUa);
  const hasBrowserContext = Boolean(origin || referer);

  const callerType: RequestDiagnostics['callerType'] =
    (browserUa && hasBrowserContext)
      ? 'browser'
      : (scriptUa && !hasBrowserContext)
        ? 'anonymous-script'
        : 'unknown';

  return {
    callerType,
    userAgent,
    origin,
    referer,
    hasSessionSignals,
  };
}

async function probeCanonicalPreviewUrl(code: string): Promise<{ reachable: boolean; status: number; finalUrl: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const targetUrl = `https://${PREVIEW_HOST}/preview/${encodeURIComponent(code)}`;
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/json;q=0.9,*/*;q=0.1',
        'user-agent': 'kloner-status-recovery/1.0',
      },
    });

    const finalUrl = response.url || null;
    const reachable = response.status >= 200 && response.status < 400;
    return { reachable, status: response.status, finalUrl };
  } catch (error: any) {
    const aborted = error?.name === 'AbortError';
    return { reachable: false, status: aborted ? 504 : 502, finalUrl: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleWebcontainerStatus(code: string, appId: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/status/${code}?appId=${appId}`,
      method: "GET",
      userCtx: uid ? { uid } : undefined,
      noPrefix: true,
    });
    const responseHeaders = new Headers();
    const retryAfter = response.upstream?.headers?.get?.('retry-after');
    const upstreamRequestId = response.upstream?.headers?.get?.('x-request-id');

    if (retryAfter) responseHeaders.set('retry-after', retryAfter);
    if (upstreamRequestId) responseHeaders.set('x-request-id', upstreamRequestId);

    if (response.status >= 400) {
      if (response.status >= 500) {
        const recovery = await probeCanonicalPreviewUrl(code);
        if (recovery.reachable) {
          console.warn('[webcontainer-status] recovered healthy preview from canonical probe after upstream 5xx', {
            appId,
            code,
            status: response.status,
            recoveredUrl: recovery.finalUrl,
            previewHost: PREVIEW_HOST,
          });

          return NextResponse.json(
            {
              ok: true,
              status: 'ready',
              ready: true,
              uiStage: 'app_ready',
              uiTitle: 'Preview recovered',
              uiMessage: 'Recovered preview health after a transient status service error.',
              url: recovery.finalUrl || `https://${PREVIEW_HOST}/preview/${encodeURIComponent(code)}`,
              machineId: null,
              recoveredFromStatusError: true,
            },
            { headers: responseHeaders },
          );
        }
      }

      const payload = (response.json && typeof response.json === 'object') ? response.json : {};
      const error = (payload as any)?.error || 'Backend error';
      // Preserve backend diagnostics (uiTitle/uiMessage/events/etc) so the frontend can render them.
      return NextResponse.json({ ...payload, error }, { status: response.status, headers: responseHeaders });
    }
    return NextResponse.json(response.json, { headers: responseHeaders });
  } catch (error) {
    console.error('Backend call error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const appId = url.searchParams.get('appId');

  if (!code || !appId) {
    return NextResponse.json({ error: 'Missing code or appId parameter' }, { status: 400 });
  }

  const internal = request.headers.get('x-kloner-internal') || '';
  const internalSecret = process.env.INTERNAL_API_SECRET || '';
  const isInternal = Boolean(internalSecret) && internal === internalSecret;
  const diagnostics = getRequestDiagnostics(request, isInternal);

  if (!isInternal) {
    let authedUid: string | undefined;
    const response = await requireSessionAndMaybeCsrf(
      request,
      async ({ uid, req: authedReq }) => {
        authedUid = uid;
        return handleWebcontainerStatus(code, appId, uid);
      },
      { csrf: false, methods: ['GET'] } // Status polling doesn't need CSRF
    );

    if (response.status === 401 || response.status >= 500) {
      console.warn('[webcontainer-status] polling request diagnostics', {
        appId,
        code,
        status: response.status,
        uid: authedUid || null,
        callerType: diagnostics.callerType,
        userAgent: diagnostics.userAgent,
        origin: diagnostics.origin || null,
        referer: diagnostics.referer || null,
        hasSessionSignals: diagnostics.hasSessionSignals,
      });
    }

    return response;
  }

  try {
    const response = await handleWebcontainerStatus(code, appId);
    if (response.status >= 500) {
      console.warn('[webcontainer-status] internal polling request diagnostics', {
        appId,
        code,
        status: response.status,
        callerType: diagnostics.callerType,
        userAgent: diagnostics.userAgent,
        origin: diagnostics.origin || null,
        referer: diagnostics.referer || null,
      });
    }
    return response;
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}