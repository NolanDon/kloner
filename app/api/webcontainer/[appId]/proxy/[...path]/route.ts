// app/api/webcontainer/[appId]/proxy/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '../../../../_lib/auth';
import { assertAppBuilderScope } from '../../../../_lib/appBuilderScope';

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
  { params }: { params: { appId: string; path?: string[] } }
) {
  try {
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, params.appId);

    const subPath = (params.path || []).join('/');
    const targetUrl = `${BACKEND_ORIGIN}/api/v1/webcontainer/${params.appId}/proxy/${subPath}`;

    try {
      const upstream = await fetch(targetUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
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
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, params.appId);

    const subPath = (params.path || []).join('/');
    const targetUrl = `${BACKEND_ORIGIN}/api/v1/webcontainer/${params.appId}/proxy/${subPath}`;

    console.log(`Proxying request to: ${targetUrl}`);

    const upstream = await fetch(targetUrl, {
      headers: {
        'Accept': req.headers.get('accept') || '*/*',
        'User-Agent': req.headers.get('user-agent') || 'Next.js Proxy',
      },
      // Add a timeout to avoid hanging requests
      signal: AbortSignal.timeout(30000),
    }).catch(err => {
      console.error(`Failed to fetch ${targetUrl}:`, err);
      throw err;
    });

    console.log(`Upstream response status: ${upstream.status}, content-type: ${upstream.headers.get('content-type')}`);
    console.log(`Upstream response ok: ${upstream.ok}`);
    
    if (upstream.status === 404) {
      console.error(`404 error for ${targetUrl} - static asset not found`);
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    // If this is HTML content, we need to rewrite URLs
    if (isHtml && upstream.ok) {
      try {
        const text = await upstream.text();
        // Replace absolute localhost URLs with proxy paths, but avoid script content
        const proxyBase = `/api/webcontainer/${params.appId}/proxy`;
        
        // More targeted replacement: only in HTML attributes, not in script content
        let rewrittenHtml = text
          .replace(/(<[^>]*\s(?:src|href|action|formaction|data-src|data-href)\s*=\s*["'])(http:\/\/localhost:\d+\/[^"']*)/g, `$1${proxyBase}/$2`.replace(/http:\/\/localhost:\d+\//, ''))
          .replace(/(<[^>]*\s(?:src|href|action|formaction|data-src|data-href)\s*=\s*["'])(https:\/\/localhost:\d+\/[^"']*)/g, `$1${proxyBase}/$2`.replace(/https:\/\/localhost:\d+\//, ''))
          // Keep Next.js root-relative asset URLs inside the proxy scope.
          .replace(/(<[^>]*\s(?:src|href|action|formaction|data-src|data-href)\s*=\s*["'])\/_next\//g, `$1${proxyBase}/_next/`);
        
        // Add a shim script early in <head> (externalized to avoid CSP inline-script reports)
        if (rewrittenHtml.includes('<head>')) {
          rewrittenHtml = rewrittenHtml.replace(
            '<head>',
            '<head><script src="/proxy/next-router-shim.js"></script>'
          );
        }
        
        // Also modify __NEXT_DATA__ script tag if it exists
        const nextDataRegex = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
        const nextDataMatch = rewrittenHtml.match(nextDataRegex);
        if (nextDataMatch) {
          try {
            const nextData = JSON.parse(nextDataMatch[1]);
            console.log('Found __NEXT_DATA__:', nextData);

            // Ensure Next.js loads chunks + CSS through the proxy base path.
            nextData.assetPrefix = proxyBase;
            
            // Ensure safe router state defaults
            if (nextData.page && nextData.page !== '/') {
              nextData.page = '/';
            }
            if (nextData.pathname && nextData.pathname !== '/') {
              nextData.pathname = '/';
            }
            
            const modifiedNextData = JSON.stringify(nextData);
            rewrittenHtml = rewrittenHtml.replace(nextDataRegex, `<script id="__NEXT_DATA__" type="application/json">${modifiedNextData}</script>`);
            console.log('Modified __NEXT_DATA__ for safe router state');
          } catch (e) {
            console.error('Failed to parse __NEXT_DATA__:', e);
          }
        }
        
        const res = new NextResponse(rewrittenHtml, {
          status: upstream.status,
          statusText: upstream.statusText,
        });

        // Copy relevant headers from upstream
        const headersToForward = [
          'content-type',
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

        // Set content-length for the rewritten content
        res.headers.set('content-length', Buffer.byteLength(rewrittenHtml, 'utf8').toString());

        // Set COEP and CORP for HTML documents
        res.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

        // Allow credentials for same-origin requests
        const origin = req.headers.get('origin');
        if (origin) {
          res.headers.set('Access-Control-Allow-Origin', origin);
          res.headers.set('Access-Control-Allow-Credentials', 'true');
        }

        return res;
      } catch (err) {
        console.error('Failed to rewrite HTML:', err);
        // Fall back to original response
      }
    }

    // Clone the response so we can read and modify headers
    const res = new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
    });

    // Set CORP for sub-resources
    res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    
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
    
    return NextResponse.json({ error: 'Proxy request failed' }, { status: 500 });
  }
}

// Handle POST requests
export async function POST(
  req: NextRequest,
  { params }: { params: { appId: string; path?: string[] } }
) {
  return proxyRequest(req, params);
}

// Handle PUT requests
export async function PUT(
  req: NextRequest,
  { params }: { params: { appId: string; path?: string[] } }
) {
  return proxyRequest(req, params);
}

// Handle DELETE requests
export async function DELETE(
  req: NextRequest,
  { params }: { params: { appId: string; path?: string[] } }
) {
  return proxyRequest(req, params);
}

// Handle PATCH requests
export async function PATCH(
  req: NextRequest,
  { params }: { params: { appId: string; path?: string[] } }
) {
  return proxyRequest(req, params);
}

// Generic proxy function for non-GET requests
async function proxyRequest(req: NextRequest, params: { appId: string; path?: string[] }) {
  try {
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, params.appId);

    const subPath = (params.path || []).join('/');
    const targetUrl = `${BACKEND_ORIGIN}/api/v1/webcontainer/${params.appId}/proxy/${subPath}`;

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
