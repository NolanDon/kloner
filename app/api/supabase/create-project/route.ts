// app/api/supabase/create-project/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndMaybeCsrf } from '../../_lib/route-guard';
import { getAdminDb } from '../../_lib/auth';
import crypto from "crypto";

const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID;
const SUPABASE_CLIENT_SECRET = process.env.SUPABASE_CLIENT_SECRET;
const SUPABASE_REDIRECT_URI = process.env.SUPABASE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/supabase/oauth/callback`;

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

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

        const state = crypto.randomBytes(24).toString("base64url");

        // Store state in Firestore for verification (avoids in-memory state issues on serverless)
        const db = getAdminDb();
        await db
          .collection("oauth_states")
          .doc(`supabase_${state}`)
          .set({
            provider: "supabase",
            uid,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
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