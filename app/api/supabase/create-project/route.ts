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
        const body = await authedReq.json().catch(() => ({} as any));
        const appId = typeof body?.appId === "string" ? body.appId.trim() : "";

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

        // Also record progress under the user's nested integrations collection
        // so Supabase-related setup state is discoverable at:
        // /kloner_users/{uid}/integrations/supabase_setup
        await db
          .collection("kloner_users")
          .doc(uid)
          .collection("integrations")
          .doc("supabase_setup")
          .set(
            {
              provider: "supabase",
              status: "IN_PROGRESS",
              step: "OAUTH",
              ...(appId ? { appId } : {}),
              oauthState: state,
              oauthStartedAt: new Date(),
              oauthExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
              // Clear stale attempt data so a new authorization can't instantly fail
              // due to previous projectRef/notFound timers.
              error: null,
              projectId: null,
              projectRef: null,
              projectName: null,
              organizationSlug: null,
              regionSelection: null,
              waitActiveStartedAt: null,
              provisioningStartedAt: null,
              lastSupabasePollError: null,
              lastPollErrorPersistedAtMs: null,
              notFoundFirstAtMs: null,
              notFoundCount: 0,
              lastProjectListLookupAt: null,
              createProjectRequestId: null,
              updatedAt: new Date(),
            },
            { merge: true }
          );

        // Supabase Platform OAuth authorization URL
        // (The supabase.com hostname serves the marketing site and returns 404 for /oauth/*.)
        const authUrl = new URL('https://api.supabase.com/v1/oauth/authorize');
        authUrl.searchParams.set('client_id', SUPABASE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', SUPABASE_REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'code');
        // We need org access to pick/create an organization, project access to create/read the project,
        // and secrets access to fetch project API keys for preview env injection.
        authUrl.searchParams.set(
          'scope',
          'organizations:read organizations:create projects:create projects:read secrets:read'
        );
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