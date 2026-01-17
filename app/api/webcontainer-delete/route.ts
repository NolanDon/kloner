// app/api/webcontainer-delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callBackend } from '../../../src/lib/callBackend';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';

async function handleWebcontainerDelete(code: string, appId: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/${code}?appId=${appId}`,
      method: "DELETE",
      userCtx: uid ? { uid } : undefined,
      noPrefix: true,
    });
    if (response.status >= 400) {
      const error = response.json?.error || 'Backend error';
      return NextResponse.json({ error }, { status: response.status });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Backend call error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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
        return handleWebcontainerDelete(code, appId, uid);
      },
      { csrf: true, methods: ['DELETE'] }
    );
  }

  try {
    return await handleWebcontainerDelete(code, appId);
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}