// app/api/webcontainer/[appId]/proxy/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../../../_lib/processRegistry';
import { verifySession } from '../../../../_lib/auth';
import { assertAppBuilderScope } from '../../../../_lib/appBuilderScope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    console.log(`App info:`, { appId: params.appId, port: info.port, tempDir: info.tempDir });

    const upstream = await fetch(targetUrl, {
      headers: {
        'Accept': req.headers.get('accept') || '*/*',
        'User-Agent': req.headers.get('user-agent') || 'Next.js Proxy',
      },
      // Add a timeout to avoid hanging requests
      signal: AbortSignal.timeout(30000),
    }).catch(err => {
      console.error(`Failed to fetch ${targetUrl}:`, err);
      console.error(`App registry info:`, { appId: params.appId, port: info.port, tempDir: info.tempDir });
      throw err;
    });

    console.log(`Upstream response status: ${upstream.status}, content-type: ${upstream.headers.get('content-type')}`);
    console.log(`Upstream response ok: ${upstream.ok}`);
    
    if (upstream.status === 404) {
      console.error(`404 error for ${targetUrl} - static asset not found`);
      console.error(`App is running on port ${info.port}, tempDir: ${info.tempDir}`);
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
        
        // Add a base tag to set the correct base URL for the iframe
        if (rewrittenHtml.includes('<head>')) {
          rewrittenHtml = rewrittenHtml.replace('<head>', `<head><script>
(function() {
  // Override createInitialRouterState globally before Next.js loads
  var originalCreateInitialRouterState;
  
  Object.defineProperty(window, 'createInitialRouterState', {
    get: function() {
      return function(options) {
        console.log('Intercepted createInitialRouterState call with options:', options);
        try {
          // Ensure required properties exist with safe defaults
          if (!options) options = {};
          
          // Set safe defaults for router state
          options.initialCanonicalUrl = options.initialCanonicalUrl || '/';
          options.initialTree = options.initialTree || ['', {}, { children: ['page', {}, { children: ['', {}, {}] }] }];
          options.initialParallelRoutes = options.initialParallelRoutes || {};
          options.initialSeedData = options.initialSeedData || {};
          
          // Normalize canonical URL
          if (typeof options.initialCanonicalUrl === 'string') {
            try {
              const url = new URL(options.initialCanonicalUrl, 'http://localhost:3000');
              options.initialCanonicalUrl = url.pathname || '/';
            } catch (e) {
              options.initialCanonicalUrl = '/';
            }
          }
          
          console.log('Modified options:', options);
          
          // Return a basic router state
          return {
            tree: options.initialTree,
            canonicalUrl: options.initialCanonicalUrl,
            parallelRoutes: options.initialParallelRoutes,
            seedData: options.initialSeedData
          };
        } catch (error) {
          console.error('Error in createInitialRouterState override:', error);
          return {
            tree: ['', {}, { children: ['page', {}, { children: ['', {}, {}] }] }],
            canonicalUrl: '/',
            parallelRoutes: {},
            seedData: {}
          };
        }
      };
    },
    set: function(value) {
      originalCreateInitialRouterState = value;
    },
    configurable: true
  });
  
  console.log('createInitialRouterState global override installed');
})();
</script>`);
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
    
    return NextResponse.json({ 
      error: 'Proxy failed', 
      message: err instanceof Error ? err.message : 'Unknown error' 
    }, { status: 500 });
  }
}
