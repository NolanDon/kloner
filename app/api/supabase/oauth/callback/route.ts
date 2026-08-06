// app/api/supabase/oauth/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '../../../_lib/auth';
import { encryptString } from "../../../_lib/crypto";
import crypto from "crypto";

const SUPABASE_CLIENT_ID = process.env.SUPABASE_CLIENT_ID;
const SUPABASE_CLIENT_SECRET = process.env.SUPABASE_CLIENT_SECRET;
const SUPABASE_REDIRECT_URI = process.env.SUPABASE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/supabase/oauth/callback`;

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface SupabaseProject {
  id: string;
  name: string;
  ref?: string;
  organization_slug?: string;
  status: string;
}

type SupabaseRegionSelection =
  | { type: "smartGroup"; code: "americas" | "emea" | "apac" }
  | { type: "specific"; code: string };

type SupabaseSetupStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

function renderOauthResultHtml(params: {
  ok: boolean;
  title: string;
  message: string;
  details?: string;
  origin: string;
  dashboardUrl: string;
  payload?: Record<string, unknown>;
}): string {
  const jsonForScript = (value: unknown) =>
    JSON.stringify(value)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

  const safe = (v: string) =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const payload = params.payload || {};
  const accent = "#FF8D21";
  const danger = "#ef4444";
  const iconBg = params.ok ? accent : danger;
  const iconShadow = params.ok ? "rgba(255,141,33,0.45)" : "rgba(239,68,68,0.45)";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safe(params.title)}</title>
    <style>
      :root { --accent: ${accent}; }
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 0; min-height: 100vh; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; padding: 18px; }
      .wrap { width: 100%; max-width: 560px; }
      .card { border-radius: 24px; border: 1px solid rgba(255,255,255,0.10); background: linear-gradient(135deg, rgba(24,24,27,1) 0%, rgba(0,0,0,0.75) 70%); box-shadow: 0 24px 80px rgba(0,0,0,0.60); padding: 22px; }
      @media (min-width: 640px) { .card { padding: 30px; } }
      .kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; color: rgba(161,161,170,0.95); margin: 0 0 12px; }
      .iconRow { display: flex; justify-content: center; margin-bottom: 14px; }
      .icon { width: 56px; height: 56px; border-radius: 9999px; display: inline-flex; align-items: center; justify-content: center; background: ${iconBg}; box-shadow: 0 12px 30px ${iconShadow}; }
      .title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; text-align: center; }
      .sub { margin: 10px 0 0; color: rgba(228,228,231,0.92); font-size: 14px; line-height: 1.55; text-align: center; }
      details { margin-top: 16px; }
      summary { cursor: pointer; user-select: none; text-align: center; font-size: 13px; font-weight: 600; color: rgba(228,228,231,0.88); }
      .mono { margin-top: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; background: rgba(0,0,0,0.45); color: rgba(244,244,245,0.92); padding: 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); }
      .hint { color: rgba(161,161,170,0.95); font-size: 12px; margin-top: 14px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p class="kicker">Supabase integration</p>

        <div class="iconRow">
          <span class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
              ${params.ok
                ? `<path d="M20 6 9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
                : `<path d="M12 8v5" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M12 16.6h.01" stroke="white" stroke-width="3.5" stroke-linecap="round"/>`
              }
            </svg>
          </span>
        </div>

        <h1 class="title">${safe(params.title)}</h1>
        <p class="sub">${safe(params.message)}</p>

        ${params.details
          ? `<details>
              <summary>Show details</summary>
              <div class="mono">${safe(params.details)}</div>
            </details>`
          : ""}

        <div class="hint">You can safely close this tab when you’re done.</div>
      </div>
    </div>

    <script>
      (function () {
        var payload = ${jsonForScript({
          type: "kloner:supabase-oauth-result",
          ok: params.ok,
          title: params.title,
          message: params.message,
          details: params.details || null,
          ...payload,
        })};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, ${JSON.stringify(params.origin)});
          }
        } catch (e) {}
      })();
    </script>
  </body>
</html>`;
}

function normalizeProjectName(uid: string): string {
  const compactUid = (uid || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const stamp = Date.now().toString(36);
  const name = `kloner-${stamp}-${compactUid || "user"}`;
  // Keep it short; many SaaS APIs cap at ~32 chars.
  return name.slice(0, 32);
}

function renderOauthProvisioningHtml(params: {
  origin: string;
  dashboardUrl: string;
  uid: string;
  appId: string;
  finalizeToken: string;
  statusToken: string;
}): string {
  const jsonForScript = (value: unknown) =>
    JSON.stringify(value)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

  const safe = (v: string) =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const accent = "#FF8D21";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connecting Supabase...</title>
    <style>
      :root { --accent: ${accent}; }
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 0; min-height: 100vh; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; padding: 18px; }
      .wrap { width: 100%; max-width: 560px; }
      .card { border-radius: 24px; border: 1px solid rgba(255,255,255,0.10); background: linear-gradient(135deg, rgba(24,24,27,1) 0%, rgba(0,0,0,0.75) 70%); box-shadow: 0 24px 80px rgba(0,0,0,0.60); padding: 22px; }
      @media (min-width: 640px) { .card { padding: 30px; } }
      .kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; color: rgba(161,161,170,0.95); margin: 0 0 12px; }
      .iconRow { display: flex; justify-content: center; margin-bottom: 14px; }
      .logo { width: 56px; height: 56px; border-radius: 9999px; box-shadow: 0 12px 30px rgba(255,141,33,0.25); object-fit: contain; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.10); padding: 10px; }
      .title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; text-align: center; }
      .sub { margin: 10px 0 0; color: rgba(228,228,231,0.92); font-size: 14px; line-height: 1.55; text-align: center; }
      details { display: none; margin-top: 16px; }
      summary { cursor: pointer; user-select: none; text-align: center; font-size: 13px; font-weight: 600; color: rgba(228,228,231,0.88); }
      .mono { margin-top: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; background: rgba(0,0,0,0.45); color: rgba(244,244,245,0.92); padding: 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); }
      .hint { color: rgba(161,161,170,0.95); font-size: 12px; margin-top: 14px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p class="kicker">Supabase integration</p>

  <div class="iconRow"><img class="logo" src="/images/orange_logo.png" alt="Kloner" /></div>

        <h1 class="title" id="title">Connecting Supabase</h1>
        <p class="sub" id="msg">You can close this popout — we’re connecting Supabase in the background.</p>

        <details id="detailsWrap">
          <summary>Show details</summary>
          <div class="mono" id="details"></div>
        </details>

        <div class="hint" id="hint">Keep Kloner App open until setup completes.</div>
      </div>
    </div>

    <script>
      (function () {
        try { console.log('[kloner] Supabase provisioning popup loaded'); } catch (e) {}
        var origin = ${jsonForScript(params.origin)};
        var uid = ${jsonForScript(params.uid)};
        var appId = ${jsonForScript(params.appId)};
        var finalizeToken = ${jsonForScript(params.finalizeToken)};
        var statusToken = ${jsonForScript(params.statusToken)};
        var titleEl = document.getElementById('title');
        var msgEl = document.getElementById('msg');
        var hintEl = document.getElementById('hint');
        var detailsWrap = document.getElementById('detailsWrap');
        var detailsEl = document.getElementById('details');

        function setDone(ok, title, message, details, extraPayload) {
          if (titleEl) titleEl.textContent = title;
          if (msgEl) msgEl.textContent = message;
          if (hintEl) hintEl.textContent = "All set — you can close this popout. Keep Kloner open.";

          if (details && detailsWrap && detailsEl) {
            detailsEl.textContent = details;
            detailsWrap.style.display = 'block';
          }

          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage(Object.assign({
                type: 'kloner:supabase-oauth-result',
                ok: ok,
                title: title,
                message: message,
                details: details || null
              }, extraPayload || {}), origin);
            }
          } catch (e) {}
        }

        function showDebug(detailsText) {
          try {
            if (!detailsWrap || !detailsEl) return;
            if (!detailsText) return;
            detailsEl.textContent = String(detailsText).slice(0, 4000);
            detailsWrap.style.display = 'block';
          } catch (e) {}
        }

        function readJsonSafe(response) {
          return response.text().then(function (t) {
            try {
              return JSON.parse(t);
            } catch (e) {
              return { ok: false, error: 'invalid_json', raw: (t || '').slice(0, 800) };
            }
          });
        }

        fetch('/api/supabase/oauth/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ uid: uid, appId: appId, finalizeToken: finalizeToken })
        })
        .then(readJsonSafe)
        .then(function (data) {
          if (!(data && data.ok)) {
            var err = (data && (data.error || data.message)) ? String(data.error || data.message) : 'unknown_error';
            if (data && data.raw) err += '\\n\\nResponse (truncated):\\n' + String(data.raw);
            setDone(false, 'Supabase setup failed', 'Something went wrong while starting Supabase setup.', err, {});
            return;
          }

          // Now poll our status endpoint; it will finalize once Supabase reports ACTIVE.
          var started = Date.now();
          var maxMs = 5 * 60 * 1000; // 5 minutes (hard stop; avoid infinite hangs)
          var notFoundFirstAt = 0;
          var notFoundCount = 0;
          var lastStep = '';
          var lastStepChangedAt = Date.now();

          function poll() {
            var statusUrl = '/api/supabase/project-status?uid=' + encodeURIComponent(uid) + '&statusToken=' + encodeURIComponent(statusToken) + (appId ? '&appId=' + encodeURIComponent(appId) : '');
            fetch(statusUrl, { credentials: 'same-origin', cache: 'no-store' })
              .then(function (r) {
                return r.text().then(function (t) {
                  try { return JSON.parse(t); } catch (e) { return { completed: false, parseError: true, raw: (t || '').slice(0, 800) }; }
                });
              })
              .then(function (s) {
                if (s && s.completed) {
                  if (s.ok) {
                    var name = (s.project && s.project.name) ? String(s.project.name) : '';
                    var statusLine = (s.project && s.project.status) ? String(s.project.status) : '';
                    var details = '';
                    if (name) details += 'Project: ' + name;
                    if (statusLine) details += (details ? '\\n' : '') + 'Status: ' + statusLine;
                    setDone(true, 'Supabase connected', 'All set. You can return to Kloner.', details || null, { project: s.project || null });
                  } else {
                    var errText = String(s.error || 'unknown_error');
                    var extra = '';
                    try {
                      if (s.step) extra += (extra ? '\\n' : '') + 'Step: ' + String(s.step);
                      if (s.projectId) extra += (extra ? '\\n' : '') + 'Project id: ' + String(s.projectId);
                      if (s.projectRef) extra += (extra ? '\\n' : '') + 'Project ref: ' + String(s.projectRef);
                      if (s.lastSupabasePollError) extra += (extra ? '\\n\\n' : '\\n\\n') + 'Last poll error: ' + JSON.stringify(s.lastSupabasePollError);
                    } catch (e) {}
                    setDone(false, 'Supabase setup failed', 'Something went wrong while creating your Supabase project.', [errText, extra].filter(Boolean).join('\\n'), {});
                  }
                  return;
                }

                if (Date.now() - started > maxMs) {
                  setDone(
                    false,
                    'Supabase setup timed out',
                    'This is taking too long. The setup will not keep hanging forever—please return to Kloner and retry Supabase setup.',
                    'timeout_waiting_for_project',
                    {}
                  );
                  return;
                }

                if (s && s.parseError && s.raw && detailsWrap && detailsEl) {
                  detailsEl.textContent = 'Status parse error. Response (truncated):\n' + String(s.raw);
                  detailsWrap.style.display = 'block';
                }

                // Surface backend debug info if present (helps diagnose "silent" Supabase failures).
                try {
                  if (s && s.lastSupabasePollError) {
                    var dbg = '';
                    if (s.step) dbg += 'Step: ' + String(s.step);
                    if (s.projectId) dbg += (dbg ? '\\n' : '') + 'Project id: ' + String(s.projectId);
                    if (s.projectRef) dbg += (dbg ? '\\n' : '') + 'Project ref: ' + String(s.projectRef);
                    dbg += (dbg ? '\\n' : '') + 'Last poll error: ' + JSON.stringify(s.lastSupabasePollError);
                    showDebug(dbg);
                  }
                } catch (e) {}

                // If Supabase says "Project not found" for long enough, stop polling and show a clear error.
                try {
                  var stepNow = (s && s.step) ? String(s.step) : '';
                  if (stepNow && stepNow !== lastStep) {
                    lastStep = stepNow;
                    lastStepChangedAt = Date.now();
                  }

                  var pe = (s && s.lastSupabasePollError) ? s.lastSupabasePollError : null;
                  var httpStatus = pe && typeof pe.httpStatus === 'number' ? pe.httpStatus : 0;
                  var body = pe && typeof pe.body === 'string' ? pe.body : '';
                  var isNotFound = httpStatus === 404 && body && body.indexOf('Project not found') !== -1;

                  if (isNotFound) {
                    notFoundCount += 1;
                    if (!notFoundFirstAt) notFoundFirstAt = Date.now();
                  }

                  var stuckMs = Date.now() - lastStepChangedAt;
                  var notFoundMs = notFoundFirstAt ? (Date.now() - notFoundFirstAt) : 0;

                  // Fail fast on sustained 404s: waiting longer is extremely unlikely to fix it.
                  if (isNotFound && (notFoundMs > 60 * 1000 || notFoundCount >= 8)) {
                    var extra2 = '';
                    try {
                      if (s.step) extra2 += (extra2 ? '\\n' : '') + 'Step: ' + String(s.step);
                      if (s.projectId) extra2 += (extra2 ? '\\n' : '') + 'Project id: ' + String(s.projectId);
                      if (s.projectRef) extra2 += (extra2 ? '\\n' : '') + 'Project ref: ' + String(s.projectRef);
                      if (s.lastSupabasePollError) extra2 += (extra2 ? '\\n\\n' : '\\n\\n') + 'Last poll error: ' + JSON.stringify(s.lastSupabasePollError);
                    } catch (e) {}

                    setDone(
                      false,
                      'Supabase project not found',
                      'Supabase is responding "Project not found" (404). This usually means the token cannot access the organization/project, or the project creation never succeeded. Please return to Kloner and retry Supabase setup.',
                      extra2 || 'project_not_found',
                      {}
                    );
                    return;
                  }

                  // If we stop making progress (step never changes), also stop after a while.
                  if (stuckMs > 3 * 60 * 1000) {
                    setDone(
                      false,
                      'Supabase setup stalled',
                      'Setup seems stuck (no progress for several minutes). Please return to Kloner and retry Supabase setup.',
                      (lastStep ? ('Last step: ' + lastStep) : 'stalled') + (pe ? ('\\n\\nLast poll error: ' + JSON.stringify(pe)) : ''),
                      {}
                    );
                    return;
                  }
                } catch (e) {}

                var remoteStatus = (s && s.remoteStatus) ? String(s.remoteStatus) : '';
                if (remoteStatus) {
                  if (msgEl) msgEl.textContent = 'Creating your Supabase project (' + remoteStatus + '). This can take a few minutes.';
                } else {
                  var step = (s && s.step) ? String(s.step) : '';
                  if (step && msgEl) {
                    var friendly = step;
                    if (step === 'FETCH_ORG') friendly = 'Preparing your Supabase organization...';
                    else if (step === 'SELECT_REGION') friendly = 'Choosing the best region...';
                    else if (step === 'CREATE_PROJECT') friendly = 'Requesting project creation...';
                    else if (step === 'WAIT_ACTIVE') friendly = 'Waiting for Supabase to finish provisioning...';
                    else if (step === 'FINALIZE_START') friendly = 'Starting setup...';
                    msgEl.textContent = friendly;
                  }
                }

                setTimeout(poll, 2500);
              })
              .catch(function () {
                setTimeout(poll, 3000);
              });
          }

          poll();
        })
        .catch(function (e) {
          setDone(false, 'Supabase setup failed', 'Something went wrong while starting Supabase setup.', String(e && e.message ? e.message : e), {});
        });
      })();
    </script>
  </body>
</html>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = new URL(request.url).origin;
  const dashboardUrl = `${origin}/dashboard`;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  let uidForError: string | undefined;

  // Handle OAuth errors
  if (error) {
    console.error('Supabase OAuth error:', error);
    return new NextResponse(
      renderOauthResultHtml({
        ok: false,
        title: "Supabase setup failed",
        message: "Supabase returned an OAuth error.",
        details: error,
        origin,
        dashboardUrl,
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (!code || !state) {
    return new NextResponse(
      renderOauthResultHtml({
        ok: false,
        title: "Supabase setup failed",
        message: "Missing OAuth code or state.",
        details: "missing_code_or_state",
        origin,
        dashboardUrl,
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  try {
    // Verify state parameter (Firestore-backed)
    const db = getAdminDb();
    const stateRef = db.collection("oauth_states").doc(`supabase_${state}`);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      return new NextResponse(
        renderOauthResultHtml({
          ok: false,
          title: "Supabase setup failed",
          message: "This OAuth session is invalid or already used.",
          details: "invalid_state",
          origin,
          dashboardUrl,
        }),
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const stateData = stateSnap.data() as any;
    const uid = stateData?.uid as string | undefined;
    const appId = typeof stateData?.appId === "string" ? stateData.appId.trim() : "";
    uidForError = uid;
    const createdAtMs = stateData?.createdAt?.toDate?.()?.getTime?.() ?? 0;
    const expiresAtMs = stateData?.expiresAt?.toDate?.()?.getTime?.() ?? 0;
    const now = Date.now();
    const expired = (expiresAtMs && now > expiresAtMs) || (createdAtMs && now - createdAtMs > STATE_MAX_AGE_MS);

    if (!uid || expired) {
      await stateRef.delete().catch(() => undefined);
      return new NextResponse(
        renderOauthResultHtml({
          ok: false,
          title: "Supabase setup failed",
          message: "This OAuth session expired. Please try again.",
          details: "state_expired",
          origin,
          dashboardUrl,
        }),
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Clean up used state
    await stateRef.delete().catch(() => undefined);

    const setupRef = appId
      ? db
          .collection("kloner_users")
          .doc(uid)
          .collection("kloner_apps")
          .doc(appId)
          .collection("integrations")
          .doc("supabase_setup")
      : null;

    await setupRef?.set(
      {
        provider: "supabase",
        status: "IN_PROGRESS" satisfies SupabaseSetupStatus,
        step: "TOKEN_EXCHANGE",
        oauthState: null,
        oauthExpiresAt: null,
        // Clear stale attempt state so a new authorization doesn't immediately surface
        // a previous "Project not found" failure in chat.
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

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://api.supabase.com/v1/oauth/token', {
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
      const bodyText = await tokenResponse.text().catch(() => "");
      throw new Error(`Token exchange failed: ${tokenResponse.status}${bodyText ? `\n${bodyText}` : ""}`);
    }

    const tokens: SupabaseTokenResponse = await tokenResponse.json();

    const finalizeToken = crypto.randomBytes(24).toString("base64url");
    const statusToken = crypto.randomBytes(24).toString("base64url");
    await setupRef?.set(
      {
        provider: "supabase",
        status: "IN_PROGRESS" satisfies SupabaseSetupStatus,
        step: "FINALIZE_READY",
        finalizeToken,
        statusToken,
        accessToken: encryptString(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptString(tokens.refresh_token) : null,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        updatedAt: new Date(),
      },
      { merge: true }
    );

    // Important: return immediately so Supabase doesn't spin forever while we provision.
    return new NextResponse(
      renderOauthProvisioningHtml({
        origin,
        dashboardUrl: `${dashboardUrl}?supabase_connected=true&project_created=pending`,
        uid,
        appId: appId || "",
        finalizeToken,
        statusToken,
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );

  } catch (error) {
    console.error('OAuth callback error:', error);
    const details = error instanceof Error ? error.message : 'unknown_error';

    // Persist failure status (best-effort). Don't rely on oauth_state — it's deleted after validation.
    try {
      if (uidForError) {
        const db = getAdminDb();
        // Best effort — uidForError is set but appId may not be. Log only.
        console.error(`[supabase/oauth/callback] Error for uid=${uidForError}: ${details}`);
      }
    } catch {
      // ignore
    }

    return new NextResponse(
      renderOauthResultHtml({
        ok: false,
        title: "Supabase setup failed",
        message: "Something went wrong while creating your Supabase project.",
        details,
        origin,
        dashboardUrl: `${dashboardUrl}?supabase_error=${encodeURIComponent(details)}`,
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function getRecommendedRegionSelection(
  accessToken: string,
  organizationSlug: string
): Promise<SupabaseRegionSelection> {
  try {
    const url = new URL('https://api.supabase.com/v1/projects/available-regions');
    url.searchParams.set('organization_slug', organizationSlug);
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.warn(
        `Supabase available-regions failed: ${res.status}${bodyText ? `\n${bodyText}` : ""}`
      );
      return { type: "smartGroup", code: "americas" };
    }

    const data: any = await res.json();
    const rec = data?.recommendations;

    const smart = rec?.smartGroup;
    if (smart?.type === "smartGroup" && typeof smart?.code === "string") {
      const code = smart.code as SupabaseRegionSelection["code"];
      if (code === "americas" || code === "emea" || code === "apac") {
        return { type: "smartGroup", code };
      }
    }

    const specific = Array.isArray(rec?.specific) ? rec.specific : [];
    const bestSpecific =
      specific.find((r: any) => r?.status === "capacity") ??
      specific.find((r: any) => r?.status) ??
      specific[0];

    if (bestSpecific?.type === "specific" && typeof bestSpecific?.code === "string") {
      return { type: "specific", code: bestSpecific.code };
    }

    return { type: "smartGroup", code: "americas" };
  } catch (e) {
    console.warn('Supabase available-regions lookup threw:', e);
    return { type: "smartGroup", code: "americas" };
  }
}

async function getOrCreateOrganizationSlug(accessToken: string): Promise<string> {
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
  if (Array.isArray(organizations) && organizations.length > 0) {
    const slug = organizations[0]?.slug;
    if (slug && typeof slug === "string") return slug;
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
  if (!newOrg?.slug) throw new Error('Failed to create organization (missing slug)');
  return newOrg.slug;
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