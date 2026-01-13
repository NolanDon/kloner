// app/api/webcontainer/[appId]/proxy/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../../../_lib/processRegistry';

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
  { params }: { params: { appId: string; path?: string[] } }
) {
  try {
    const registry = getProcessRegistry();
    
    // Detailed logging to stderr to ensure it shows
    console.error('[Proxy HEAD] =========== HEAD REQUEST ===========');
    console.error('[Proxy HEAD] Checking appId:', params.appId);
    console.error('[Proxy HEAD] Registry size:', registry.size);
    console.error('[Proxy HEAD] Registry keys:', Array.from(registry.keys()));
    console.error('[Proxy HEAD] Full registry:', JSON.stringify(
      Array.from(registry.entries()).map(([k, v]) => [k, { port: v.port }])
    ));
    
    const info = registry.get(params.appId);
    console.error('[Proxy HEAD] Info found:', !!info);
    
    if (!info) {
      console.error('[Proxy HEAD] App not found in registry:', params.appId);
      return new NextResponse(null, { status: 404 });
    }

    console.error('[Proxy HEAD] App found, port:', info.port);
    const subPath = (params.path || []).join('/');
    const targetUrl = `http://localhost:${info.port}/${subPath}`;

    try {
      const upstream = await fetch(targetUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });

      console.error('[Proxy HEAD] Upstream response status:', upstream.status);
      return new NextResponse(null, {
        status: upstream.status,
        headers: {
          'Cross-Origin-Resource-Policy': 'same-site',
        },
      });
    } catch (err) {
      console.error('[Proxy HEAD] Upstream server error:', err);
      return new NextResponse(null, { status: 503 });
    }
  } catch (err) {
    console.error('[Proxy HEAD] Outer error:', err);
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { appId: string; path?: string[] } }
) {
  try {
    const registry = getProcessRegistry();
    const info = registry.get(params.appId);
    
    if (!info) {
      console.error(`App not running: ${params.appId}`);
      console.log('Running apps:', Array.from(registry.keys()));
      return NextResponse.json({ error: 'App not running', appId: params.appId }, { status: 404 });
    }

    const subPath = (params.path || []).join('/');
    const targetUrl = `http://localhost:${info.port}/${subPath}`;

    console.log(`Proxying request to: ${targetUrl}`);

    const upstream = await fetch(targetUrl, {
      headers: {
        'Accept': req.headers.get('accept') || '*/*',
        'User-Agent': req.headers.get('user-agent') || 'Next.js Proxy',
      },
      // Add a timeout to avoid hanging requests
      signal: AbortSignal.timeout(30000),
    });

    // Clone the response so we can read and modify headers
    const body = upstream.body;
    const res = new NextResponse(body, {
      status: upstream.status,
      statusText: upstream.statusText,
    });

    // Copy relevant headers from upstream
    const headersToForward = [
      'content-type',
      'content-length',
      'cache-control',
      'etag',
      'last-modified',
    ];
    
    headersToForward.forEach(header => {
      const value = upstream.headers.get(header);
      if (value) {
        res.headers.set(header, value);
      }
    });

    // Set security headers for COEP/CORP compliance
    res.headers.set('Cross-Origin-Resource-Policy', 'same-site');
    res.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    
    // Allow credentials for same-origin requests
    const origin = req.headers.get('origin');
    if (origin) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    return res;
  } catch (err) {
    console.error('Proxy error:', err);
    
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 });
    }
    
    return NextResponse.json({ 
      error: 'Proxy failed', 
      message: err instanceof Error ? err.message : 'Unknown error' 
    }, { status: 500 });
  }
}
