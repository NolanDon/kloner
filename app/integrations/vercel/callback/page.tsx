// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieState = req.cookies.get("vercel_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }

  const body = new URLSearchParams({
    code,
    client_id: process.env.VERCEL_OAUTH_CLIENT_ID!,
    client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET!,
    redirect_uri:
      process.env.NODE_ENV === "production"
        ? "https://kloner.app/api/vercel/oauth/callback"
        : "http://localhost:3000/api/vercel/oauth/callback",
  });

  const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("Vercel token exchange failed", tokenRes.status, text);
    return NextResponse.json({ error: "token_exchange_failed" }, { status: 500 });
  }

  const json = await tokenRes.json();
  // json: { access_token, token_type, team_id?, user_id?, ... }
  // Persist json.access_token + team_id/user_id against your Firebase user here.

  return NextResponse.redirect("/dashboard?vercel=connected");
}
