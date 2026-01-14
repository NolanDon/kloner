// app/api/supabase/create-project/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndMaybeCsrf } from '../../_lib/route-guard';

const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID;
const SUPABASE_CLIENT_SECRET = process.env.SUPABASE_CLIENT_SECRET;
const SUPABASE_REDIRECT_URI = process.env.SUPABASE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/supabase/oauth/callback`;

// Extend global type for OAuth states
declare global {
  var supabaseOAuthStates: Map<string, { userId: string; timestamp: number }> | undefined;
}

export async function POST(request: NextRequest) {
  return requireSessionAndMaybeCsrf(
    request,
    async ({ uid, req: authedReq }) => {
      try {
        if (!SUPABASE_CLIENT_ID || !SUPABASE_CLIENT_SECRET) {
          return NextResponse.json({
            error: 'Supabase OAuth not configured',
            message: 'Please configure SUPABASE_CLIENT_ID and SUPABASE_CLIENT_SECRET environment variables'
          }, { status: 500 });
        }

        // Generate state parameter for security
        const state = Buffer.from(JSON.stringify({
          userId: uid,
          timestamp: Date.now()
        })).toString('base64');

        // Store state in session/database for verification
        // For now, we'll use a simple in-memory store (in production, use Redis/database)
        global.supabaseOAuthStates = global.supabaseOAuthStates || new Map();
        global.supabaseOAuthStates.set(state, {
          userId: uid,
          timestamp: Date.now()
        });

        // Supabase OAuth authorization URL
        const authUrl = new URL('https://supabase.com/oauth/authorize');
        authUrl.searchParams.set('client_id', SUPABASE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', SUPABASE_REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'projects:create projects:read projects:update projects:delete');
        authUrl.searchParams.set('state', state);

        return NextResponse.json({
          authUrl: authUrl.toString(),
          state
        });

      } catch (error) {
        console.error('Error initiating Supabase OAuth:', error);
        return NextResponse.json({
          error: 'Failed to initiate OAuth flow',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
      }
    },
    { csrf: true, methods: ['POST'] }
  );
}