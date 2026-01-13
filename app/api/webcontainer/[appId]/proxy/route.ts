// app/api/webcontainer/[appId]/proxy/route.ts
// Handles requests to /api/webcontainer/{appId}/proxy/ (without additional path)
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../../_lib/processRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Handle HEAD requests for health checks
export async function HEAD(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  try {
    console.error('[Proxy HEAD at /proxy level] =========== HEAD REQUEST ===========');
    console.error('[Proxy HEAD at /proxy level] URL:', req.url);
    console.error('[Proxy HEAD at /proxy level] AppId:', params.appId);
    
    const registry = getProcessRegistry();
    console.error('[Proxy HEAD at /proxy level] Registry size:', registry.size);
    console.error('[Proxy HEAD at /proxy level] Registry keys:', Array.from(registry.keys()));
    
    const info = registry.get(params.appId);
    console.error('[Proxy HEAD at /proxy level] Info found:', !!info);
    
    if (!info) {
      console.error('[Proxy HEAD at /proxy level] App not found in registry:', params.appId);
      return new NextResponse(null, { status: 404 });
    }

    console.error('[Proxy HEAD at /proxy level] App found on port:', info.port);
    const targetUrl = `http://localhost:${info.port}/`;

    try {
      const upstream = await fetch(targetUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });

      console.error('[Proxy HEAD at /proxy level] Upstream status:', upstream.status);
      return new NextResponse(null, {
        status: upstream.status,
        headers: {
          'Cross-Origin-Resource-Policy': 'same-site',
        },
      });
    } catch (err) {
      console.error('[Proxy HEAD at /proxy level] Upstream error:', err);
      return new NextResponse(null, { status: 503 });
    }
  } catch (err) {
    console.error('[Proxy HEAD at /proxy level] Error:', err);
    return new NextResponse(null, { status: 500 });
  }
}

// Handle GET requests
export async function GET(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  try {
    const registry = getProcessRegistry();
    const info = registry.get(params.appId);
    
    if (!info) {
      return new NextResponse('App not found', { status: 404 });
    }

    const targetUrl = `http://localhost:${info.port}/`;

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'HEAD' ? req.body : undefined,
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Cross-Origin-Resource-Policy', 'same-site');

      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch (err) {
      console.error('[Proxy GET at /proxy level] Error:', err);
      return new NextResponse('Upstream server error', { status: 503 });
    }
  } catch (err) {
    console.error('[Proxy GET at /proxy level] Error:', err);
    return new NextResponse('Server error', { status: 500 });
  }
}
