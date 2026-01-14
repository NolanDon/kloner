// app/api/webcontainer/[appId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProcessRegistry } from '../../_lib/processRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Handle HEAD requests to check if an appId is registered/running.
export async function HEAD(
  req: NextRequest,
  { params }: { params: { appId: string } }
) {
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
}
