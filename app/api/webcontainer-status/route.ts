// app/api/webcontainer-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callBackend } from '../../../src/lib/callBackend';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';

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

async function handleWebcontainerStatus(code: string, appId: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/status/${code}?appId=${appId}`,
      method: "GET",
      userCtx: uid ? { uid } : undefined,
      noPrefix: true,
    });
    if (response.status >= 400) {
      const payload = (response.json && typeof response.json === 'object') ? response.json : {};
      const error = (payload as any)?.error || 'Backend error';
      // Preserve backend diagnostics (uiTitle/uiMessage/events/etc) so the frontend can render them.
      return NextResponse.json({ ...payload, error }, { status: response.status });
    }
    return NextResponse.json(response.json);
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

    if (response.status === 429 || response.status === 401 || response.status >= 500) {
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
    if (response.status === 429 || response.status >= 500) {
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