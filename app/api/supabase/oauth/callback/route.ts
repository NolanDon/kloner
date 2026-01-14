// app/api/supabase/oauth/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '../../../_lib/auth';

const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID;
const SUPABASE_CLIENT_SECRET = process.env.SUPABASE_CLIENT_SECRET;
const SUPABASE_REDIRECT_URI = process.env.SUPABASE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/supabase/oauth/callback`;

// Extend global type for OAuth states
declare global {
  var supabaseOAuthStates: Map<string, { userId: string; timestamp: number }> | undefined;
}

interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface SupabaseProject {
  id: string;
  name: string;
  database_url: string;
  anon_key: string;
  service_role_key: string;
  status: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    console.error('Supabase OAuth error:', error);
    return NextResponse.redirect(
      new URL(`/dashboard?supabase_error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/dashboard?supabase_error=missing_code_or_state', request.url)
    );
  }

  try {
    // Verify state parameter
    const storedState = global.supabaseOAuthStates?.get(state);
    if (!storedState) {
      return NextResponse.redirect(
        new URL('/dashboard?supabase_error=invalid_state', request.url)
      );
    }

    // Check if state is expired (5 minutes)
    if (Date.now() - storedState.timestamp > 5 * 60 * 1000) {
      return NextResponse.redirect(
        new URL('/dashboard?supabase_error=state_expired', request.url)
      );
    }

    const { userId } = storedState;

    // Clean up used state
    global.supabaseOAuthStates?.delete(state);

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://supabase.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: SUPABASE_CLIENT_ID!,
        client_secret: SUPABASE_CLIENT_SECRET!,
        code,
        redirect_uri: SUPABASE_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }

    const tokens: SupabaseTokenResponse = await tokenResponse.json();

    // Create a new Supabase project
    const projectResponse = await fetch('https://api.supabase.com/v1/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `kloner-${userId}-${Date.now()}`,
        database_password: generateSecurePassword(),
        organization_id: await getOrCreateOrganization(tokens.access_token),
        plan: 'free', // Start with free plan
      }),
    });

    if (!projectResponse.ok) {
      throw new Error(`Project creation failed: ${projectResponse.status}`);
    }

    const project: SupabaseProject = await projectResponse.json();

    // Wait for project to be ready (this might take a few minutes)
    await waitForProjectReady(tokens.access_token, project.id);

    // Get the final project details with connection info
    const finalProjectResponse = await fetch(`https://api.supabase.com/v1/projects/${project.id}`, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
      },
    });

    if (!finalProjectResponse.ok) {
      throw new Error('Failed to get final project details');
    }

    const finalProject: SupabaseProject = await finalProjectResponse.json();

    // Store project credentials securely in Firestore
    const db = getAdminDb();
    await db.collection('users').doc(userId).collection('supabase_projects').add({
      projectId: finalProject.id,
      name: finalProject.name,
      databaseUrl: finalProject.database_url,
      anonKey: finalProject.anon_key,
      serviceRoleKey: finalProject.service_role_key,
      status: finalProject.status,
      createdAt: new Date(),
      accessToken: tokens.access_token, // Store for future API calls
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    });

    // Redirect back to dashboard with success
    return NextResponse.redirect(
      new URL('/dashboard?supabase_connected=true&project_created=true', request.url)
    );

  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      new URL(`/dashboard?supabase_error=${encodeURIComponent(error instanceof Error ? error.message : 'unknown_error')}`, request.url)
    );
  }
}

async function getOrCreateOrganization(accessToken: string): Promise<string> {
  // Get user's organizations
  const orgsResponse = await fetch('https://api.supabase.com/v1/organizations', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!orgsResponse.ok) {
    throw new Error('Failed to get organizations');
  }

  const organizations = await orgsResponse.json();

  // Use the first organization or create a new one
  if (organizations.length > 0) {
    return organizations[0].id;
  }

  // Create a new organization
  const createOrgResponse = await fetch('https://api.supabase.com/v1/organizations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Kloner Projects',
    }),
  });

  if (!createOrgResponse.ok) {
    throw new Error('Failed to create organization');
  }

  const newOrg = await createOrgResponse.json();
  return newOrg.id;
}

async function waitForProjectReady(accessToken: string, projectId: string): Promise<void> {
  const maxAttempts = 60; // 5 minutes max
  const delay = 5000; // 5 seconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to check project status');
    }

    const project = await response.json();

    if (project.status === 'ACTIVE') {
      return;
    }

    if (project.status === 'FAILED') {
      throw new Error('Project creation failed');
    }

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  throw new Error('Project creation timed out');
}

function generateSecurePassword(): string {
  // Generate a secure 16-character password
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}