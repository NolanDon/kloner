// app/api/webcontainer/[appId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../_lib/processRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Handle HEAD requests for proxy health checks
export async function HEAD(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  try {
    console.error('[Proxy HEAD at appId level] =========== HEAD REQUEST ===========');
    console.error('[Proxy HEAD at appId level] URL:', req.url);
    console.error('[Proxy HEAD at appId level] Pathname:', req.nextUrl.pathname);
    
    // Check if this is a proxy request
    if (!req.nextUrl.pathname.includes('/proxy')) {
      return new NextResponse(null, { status: 404 });
    }

    const registry = getProcessRegistry();
    console.error('[Proxy HEAD at appId level] Checking appId:', params.appId);
    console.error('[Proxy HEAD at appId level] Registry size:', registry.size);
    console.error('[Proxy HEAD at appId level] Registry keys:', Array.from(registry.keys()));
    
    const info = registry.get(params.appId);
    console.error('[Proxy HEAD at appId level] Info found:', !!info);
    
    if (!info) {
      console.error('[Proxy HEAD at appId level] App not found in registry:', params.appId);
      return new NextResponse(null, { status: 404 });
    }

    console.error('[Proxy HEAD at appId level] App found on port:', info.port);
    const targetUrl = `http://localhost:${info.port}/`;

    try {
      const upstream = await fetch(targetUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });

      console.error('[Proxy HEAD at appId level] Upstream status:', upstream.status);
      return new NextResponse(null, {
        status: upstream.status,
        headers: {
          'Cross-Origin-Resource-Policy': 'same-site',
        },
      });
    } catch (err) {
      console.error('[Proxy HEAD at appId level] Upstream fetch error:', err);
      return new NextResponse(null, { status: 503 });
    }
  } catch (err) {
    console.error('[Proxy HEAD at appId level] Outer error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
