// app/api/webcontainer/[appId]/proxy/route.ts
// Handles requests to /api/webcontainer/{appId}/proxy/ (without additional path)
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../../_lib/processRegistry';
import { verifySession } from '../../../_lib/auth';
import { assertAppBuilderScope } from '../../../_lib/appBuilderScope';

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
  { params }: { params: { appId: string } }
) {
  try {
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, params.appId);

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
        signal: AbortSignal.timeout(15000),
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
    const session = await verifySession(req);
    assertAppBuilderScope(req, session.uid, params.appId);

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

      const contentType = upstream.headers.get('content-type') || '';
      const isHtml = contentType.includes('text/html');

      // If this is HTML content, we need to rewrite URLs
      if (isHtml && upstream.ok) {
        try {
          const text = await upstream.text();
          // Replace absolute localhost URLs with proxy paths, but avoid script content
          const proxyBase = `/api/webcontainer/${params.appId}/proxy`;
          let rewrittenHtml = text
            .replace(/(<[^>]*\s(?:src|href|action|formaction|data-src|data-href)\s*=\s*["'])(http:\/\/localhost:\d+\/[^"']*)/g, `$1${proxyBase}/$2`.replace(/http:\/\/localhost:\d+\//, ''))
            .replace(/(<[^>]*\s(?:src|href|action|formaction|data-src|data-href)\s*=\s*["'])(https:\/\/localhost:\d+\/[^"']*)/g, `$1${proxyBase}/$2`.replace(/https:\/\/localhost:\d+\//, ''))
            // Keep Next.js root-relative asset URLs inside the proxy scope.
            .replace(/(<[^>]*\s(?:src|href|action|formaction|data-src|data-href)\s*=\s*["'])\/_next\/([^"']*)/g, (match, start, path) => {
              const timestamp = Date.now();
              return `${start}${proxyBase}/_next/${path}${path.includes('?') ? '&' : '?'}t=${timestamp}`;
            });
          
          // Fix sandbox for iframes with srcdoc to allow scripts
          rewrittenHtml = rewrittenHtml.replace(/(<iframe[^>]*srcdoc[^>]*sandbox\s*=\s*["'])([^"']*)(["'][^>]*>)/g, (match, start, sandbox, end) => {
            if (!sandbox.includes('allow-scripts')) {
              return start + sandbox + ' allow-scripts allow-same-origin' + end;
            }
            return match;
          });
          
          // Add a base tag to set the correct base URL for the iframe
          if (rewrittenHtml.includes('<head>')) {
            rewrittenHtml = rewrittenHtml.replace('<head>', `<head><script>
(function() {
  // Aggressive global override for createInitialRouterState
  var originalCreateInitialRouterState;
  
  // Override on window
  Object.defineProperty(window, 'createInitialRouterState', {
    get: function() {
      return function(options) {
        console.log('Intercepted window.createInitialRouterState call with options:', options);
        return createInitialRouterStateOverride(options);
      };
    },
    set: function(value) {
      originalCreateInitialRouterState = value;
    },
    configurable: true
  });
  
  // Override on globalThis
  Object.defineProperty(globalThis, 'createInitialRouterState', {
    get: function() {
      return function(options) {
        console.log('Intercepted globalThis.createInitialRouterState call with options:', options);
        return createInitialRouterStateOverride(options);
      };
    },
    set: function(value) {
      originalCreateInitialRouterState = value;
    },
    configurable: true
  });
  
  // Define the override function
  function createInitialRouterStateOverride(options) {
    try {
      console.log('Processing createInitialRouterState with options:', options);
      
      // Ensure options exists
      if (!options) {
        options = {};
      }
      
      // Set safe defaults for all required properties
      if (typeof options.initialCanonicalUrl === 'undefined') {
        options.initialCanonicalUrl = '/';
      }
      
      if (!options.initialTree || !Array.isArray(options.initialTree)) {
        options.initialTree = ['', {}, { children: ['page', {}, { children: ['', {}, {}] }] }];
      }
      
      if (!options.initialParallelRoutes) {
        options.initialParallelRoutes = {};
      }
      
      if (!options.initialSeedData) {
        options.initialSeedData = {};
      }
      
      // Normalize canonical URL
      if (typeof options.initialCanonicalUrl === 'string') {
        try {
          const url = new URL(options.initialCanonicalUrl, 'http://localhost:3000');
          options.initialCanonicalUrl = url.pathname || '/';
        } catch (e) {
          options.initialCanonicalUrl = '/';
        }
      }
      
      console.log('Final processed options:', options);
      
      // Return the expected router state structure
      return {
        tree: options.initialTree,
        canonicalUrl: options.initialCanonicalUrl,
        parallelRoutes: options.initialParallelRoutes,
        seedData: options.initialSeedData
      };
    } catch (error) {
      console.error('Error in createInitialRouterState override:', error);
      // Return minimal safe defaults
      return {
        tree: ['', {}, { children: ['page', {}, { children: ['', {}, {}] }] }],
        canonicalUrl: '/',
        parallelRoutes: {},
        seedData: {}
      };
    }
  }
  
  // Also try to override on the global scope directly
  if (typeof globalThis !== 'undefined') {
    globalThis.createInitialRouterState = createInitialRouterStateOverride;
  }
  if (typeof window !== 'undefined') {
    window.createInitialRouterState = createInitialRouterStateOverride;
  }
  
  // Intercept __NEXT_DATA__ modifications
  var originalDefineProperty = Object.defineProperty;
  Object.defineProperty = function(obj, prop, descriptor) {
    if (obj === window && prop === '__NEXT_DATA__') {
      var originalSetter = descriptor.set;
      descriptor.set = function(value) {
        console.log('Intercepting __NEXT_DATA__ set:', value);
        if (value && typeof value === 'object') {
          // Ensure router state has safe defaults
          if (value.page && value.page !== '/') {
            value.page = '/';
          }
          if (value.pathname && value.pathname !== '/') {
            value.pathname = '/';
          }
        }
        return originalSetter.call(this, value);
      };
    }
    return originalDefineProperty.call(this, obj, prop, descriptor);
  };
  
  console.log('createInitialRouterState global overrides and __NEXT_DATA__ interceptor installed');
  
  // Set webpack public path to proxy base for correct chunk loading
  if (typeof __webpack_public_path__ !== 'undefined') {
    __webpack_public_path__ = '${proxyBase}/';
    console.log('Set __webpack_public_path__ to:', __webpack_public_path__);
  }
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
              // nextData.assetPrefix = proxyBase; // Disabled - let HTML rewriting handle this
              
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

          return res;
        } catch (err) {
          console.error('Failed to rewrite HTML:', err);
          // Fall back to original response
        }
      }

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');

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
