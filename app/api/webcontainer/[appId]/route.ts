// app/api/webcontainer/[appId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../_lib/processRegistry';
import { requireSessionAndMaybeCsrf } from '../../_lib/route-guard';
import { assertAppBuilderScope } from '../../_lib/appBuilderScope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Handle HEAD requests to check if an appId is registered/running.
export async function HEAD(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
  return requireSessionAndMaybeCsrf(
    req,
    async ({ uid, req: authedReq }) => {
      assertAppBuilderScope(authedReq, uid, params.appId);
      
      try {
        const registry = getProcessRegistry();

        const info = registry.get(params.appId);
        if (!info) {
          return new NextResponse(null, { status: 404 });
        }

        // App is registered; treat as available.
        return new NextResponse(null, {
          status: 200,
          headers: {
            'Cross-Origin-Resource-Policy': 'same-site',
          },
        });
      } catch (err) {
        return new NextResponse(null, { status: 500 });
      }
    },
    { csrf: false, methods: ['HEAD'] } // HEAD requests don't need CSRF
  );
}
