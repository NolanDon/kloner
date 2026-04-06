// app/api/webcontainer/[appId]/proxy/route.ts
// Handles requests to /api/webcontainer/{appId}/proxy/ (without additional path)
import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '../../../_lib/auth';
import { assertAppBuilderScope } from '../../../_lib/appBuilderScope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || process.env.BACKEND_URL || process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${process.env.PORT || 8080}`;

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  // Same-origin only; do not enable wildcard CORS.
  return new NextResponse(null, { status: 204 });
}

// Handle HEAD requests for health checks
export async function HEAD(
  req: NextRequest,
  { params }: any
) {
  try {
    const session = await verifySession(req);
    const appId = (await Promise.resolve(params))?.appId;
    assertAppBuilderScope(req, session.uid, appId);

    const targetUrl = `${BACKEND_ORIGIN}/api/v1/webcontainer/${appId}/proxy/`;
    const upstream = await fetch(targetUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000),
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (error) {
    console.error('Proxy HEAD error:', error);
    return new NextResponse(null, { status: 500 });
  }
}

// Handle GET requests
export async function GET(
  req: NextRequest,
  { params }: any
) {
  return proxyRequest(req, (await Promise.resolve(params))?.appId);
}

export async function POST(
  req: NextRequest,
  { params }: any
) {
  return proxyRequest(req, (await Promise.resolve(params))?.appId);
}

// Handle PUT requests
export async function PUT(
  req: NextRequest,
  { params }: any
) {
  return proxyRequest(req, (await Promise.resolve(params))?.appId);
}

// Handle DELETE requests
export async function DELETE(
  req: NextRequest,
  { params }: any
) {
  return proxyRequest(req, (await Promise.resolve(params))?.appId);
}

// Handle PATCH requests
export async function PATCH(
  req: NextRequest,
  { params }: any
) {
  return proxyRequest(req, (await Promise.resolve(params))?.appId);
}

// Generic proxy function for non-GET requests
async function proxyRequest(req: NextRequest, appId: string) {
  try {
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, appId);

    const targetUrl = `${BACKEND_ORIGIN}/api/v1/webcontainer/${appId}/proxy/`;

    const hopByHop = new Set([
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
      'host',
      'content-length',
      'accept-encoding',
    ]);

    const outboundHeaders = new Headers();
    // Forward a minimal, safe header set.
    for (const [k, v] of req.headers.entries()) {
      const key = k.toLowerCase();
      if (hopByHop.has(key)) continue;
      // Never forward browser cookies/authorization to the upstream.
      if (key === 'cookie' || key === 'authorization') continue;
      outboundHeaders.set(k, v);
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outboundHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      signal: AbortSignal.timeout(30_000),
    });

    const responseHeaders = new Headers(upstream.headers);
    // Critical hardening: a separately-hosted upstream must not be able to set cookies on our domain.
    responseHeaders.delete('set-cookie');
    // Strip hop-by-hop headers from upstream.
    for (const h of hopByHop) responseHeaders.delete(h);
    responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`[Proxy ${req.method}] Error:`, err);
    return new NextResponse('Server error', { status: 500 });
  }
}
