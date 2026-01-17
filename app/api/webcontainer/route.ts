// app/api/webcontainer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callBackend } from '../../../src/lib/callBackend';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';
import { assertAppBuilderScope } from '../_lib/appBuilderScope';

async function handleWebcontainerPost(body: any, uid?: string) {
  const { appId, files, mode } = body || {};
  if (!appId || typeof appId !== 'string' || !files || typeof files !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Basic payload limits to reduce abuse.
  const paths = Object.keys(files);
  if (paths.length > 500) {
    return NextResponse.json({ error: 'Too many files' }, { status: 400 });
  }

  let totalBytes = 0;
  for (const p of paths) {
    const content = (files as any)[p]?.content;
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
      body: { appId, files, mode },
      userCtx: uid ? { uid } : undefined,
      noPrefix: true,
    });
    if (response.status >= 400) {
      const error = response.json?.error || 'Backend error';
      return NextResponse.json({ error }, { status: response.status });
    }
    const { code } = response.json;
    return NextResponse.json({ code }); // Return code immediately
  } catch (error) {
    console.error('Backend call error:', error);
    return NextResponse.json({ error: 'Failed to start webcontainer' }, { status: 500 });
  }
}

async function handleWebcontainerStatus(code: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/status/${code}`,
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

async function handleWebcontainerDelete(code: string, uid?: string) {
  try {
    const response = await callBackend({ headers: {} } as any, {
      path: `/api/v1/webcontainer/${code}`,
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
        return handleWebcontainerPost(body, uid);
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
        return handleWebcontainerDelete(code, uid);
      },
      { csrf: true, methods: ['DELETE'] }
    );
  }

  try {
    return await handleWebcontainerDelete(code);
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}