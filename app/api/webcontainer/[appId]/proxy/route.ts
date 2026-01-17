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
  { params }: { params: { appId: string } }
) {
  try {
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, params.appId);

    const targetUrl = `${BACKEND_ORIGIN}/api/v1/webcontainer/${params.appId}/proxy/`;
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
  { params }: { params: { appId: string } }
) {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  return proxyRequest(req, params.appId);
}

// Handle PUT requests
export async function PUT(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  return proxyRequest(req, params.appId);
}

// Handle DELETE requests
export async function DELETE(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  return proxyRequest(req, params.appId);
}

// Handle PATCH requests
export async function PATCH(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  return proxyRequest(req, params.appId);
}

// Generic proxy function for non-GET requests
async function proxyRequest(req: NextRequest, appId: string) {
  try {
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, appId);

    const targetUrl = `${BACKEND_ORIGIN}/api/v1/webcontainer/${appId}/proxy/`;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });

    const responseHeaders = new Headers(upstream.headers);
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
