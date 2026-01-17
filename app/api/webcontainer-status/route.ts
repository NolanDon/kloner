// app/api/webcontainer-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callBackend } from '../../../src/lib/callBackend';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';

async function handleWebcontainerStatus(code: string, appId: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/status/${code}?appId=${appId}`,
      method: "GET",
      userCtx: uid ? { uid } : undefined,
      noPrefix: true,
    });
    if (response.status >= 400) {
      const error = response.json?.error || 'Backend error';
      return NextResponse.json({ error }, { status: response.status });
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

  if (!isInternal) {
    return requireSessionAndMaybeCsrf(
      request,
      async ({ uid, req: authedReq }) => {
        return handleWebcontainerStatus(code, appId, uid);
      },
      { csrf: false, methods: ['GET'] } // Status polling doesn't need CSRF
    );
  }

  try {
    return await handleWebcontainerStatus(code, appId);
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}