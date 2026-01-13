// app/api/webcontainer/[appId]/proxy/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../../_lib/processRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { appId: string; path?: string[] } }
) {
  try {
    const registry = getProcessRegistry();
    const info = registry.get(params.appId);
    if (!info) {
      return NextResponse.json({ error: 'App not running' }, { status: 404 });
    }

    const subPath = (params.path || []).join('/');
    const targetUrl = `http://localhost:${info.port}/${subPath}`;

    const upstream = await fetch(targetUrl, {
      headers: {
        // Forward basic headers; omit cookies for safety or add if necessary
        'Accept': req.headers.get('accept') || '*/*',
      },
    });

    const body = upstream.body;
    const res = new NextResponse(body, {
      status: upstream.status,
      headers: upstream.headers,
    });

    // Ensure CORP for COEP environments
    res.headers.set('Cross-Origin-Resource-Policy', 'same-site');
    // Optionally expose minimal CORS for assets (kept tight by default)
    // res.headers.set('Access-Control-Allow-Origin', req.headers.get('origin') || '*');

    return res;
  } catch (err) {
    console.error('Proxy error:', err);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  }
}
