// app/api/supabase/project-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndMaybeCsrf } from '../../_lib/route-guard';
import { getAdminDb } from '../../_lib/auth';
import { decryptString, encryptString, EncryptedBlobV1 } from '../../_lib/crypto';

type SupabaseSetupStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

type SupabaseRegionSelection =
  | { type: "smartGroup"; code: "americas" | "emea" | "apac" }
  | { type: "specific"; code: string };

type SupabaseProject = {
  id: string;
  name: string;
  ref?: string;
  status?: string;
};

type SupabasePollError = {
  httpStatus: number;
  body?: string;
  requestId?: string;
  at: string;
};

function normalizeProjectName(uid: string): string {
  const compactUid = (uid || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const stamp = Date.now().toString(36);
  const name = `kloner-${stamp}-${compactUid || "user"}`;
  return name.slice(0, 32);
}

function generateSecurePassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function getOrCreateOrganizationSlug(accessToken: string): Promise<string> {
  const orgsResponse = await fetch("https://api.supabase.com/v1/organizations", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!orgsResponse.ok) {
    const bodyText = await orgsResponse.text().catch(() => "");
    throw new Error(`Failed to get organizations: ${orgsResponse.status}${bodyText ? `\n${bodyText}` : ""}`);
  }

  const organizations = await orgsResponse.json();
  if (Array.isArray(organizations) && organizations.length > 0) {
    const slug = organizations[0]?.slug;
    if (slug && typeof slug === "string") return slug;
  }

  const createOrgResponse = await fetch("https://api.supabase.com/v1/organizations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Kloner Projects" }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!createOrgResponse.ok) {
    const bodyText = await createOrgResponse.text().catch(() => "");
    throw new Error(`Failed to create organization: ${createOrgResponse.status}${bodyText ? `\n${bodyText}` : ""}`);
  }

  const newOrg = await createOrgResponse.json();
  if (!newOrg?.slug) throw new Error("Failed to create organization (missing slug)");
  return newOrg.slug;
}

async function getRecommendedRegionSelection(
  accessToken: string,
  organizationSlug: string
): Promise<SupabaseRegionSelection> {
  try {
    const url = new URL("https://api.supabase.com/v1/projects/available-regions");
    url.searchParams.set("organization_slug", organizationSlug);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.warn(`Supabase available-regions failed: ${res.status}${bodyText ? `\n${bodyText}` : ""}`);
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
    console.warn("Supabase available-regions lookup threw:", e);
    return { type: "smartGroup", code: "americas" };
  }
}

export async function GET(request: NextRequest) {
  const urlForAppId = (() => {
    try {
      return new URL(request.url);
    } catch {
      return null;
    }
  })();
  const hintedAppId = typeof urlForAppId?.searchParams?.get === "function"
    ? (urlForAppId.searchParams.get("appId") || "").trim()
    : "";

  async function computeStatus(params: { uid: string; allowAutoFinalize: boolean; appIdHint?: string }) {
    const { uid, allowAutoFinalize, appIdHint } = params;

    const normalizeId = (v: unknown): string => {
      if (typeof v === "string") return v.trim();
      if (typeof v === "number") return String(v);
      return "";
    };

    const isActiveStatus = (status: unknown): boolean => {
      if (typeof status !== "string") return false;
      const s = status.trim().toUpperCase();
      // Supabase currently returns statuses like ACTIVE_HEALTHY.
      return s === "ACTIVE" || s.startsWith("ACTIVE_") || s === "ACTIVEHEALTHY";
    };

    const toValidDateOrNull = (v: unknown): Date | null => {
      try {
        if (!v) return null;
        if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
        if (typeof v === "number") {
          const d = new Date(v);
          return Number.isFinite(d.getTime()) ? d : null;
        }
        if (typeof v === "string") {
          const d = new Date(v);
          return Number.isFinite(d.getTime()) ? d : null;
        }
        const maybeAny = v as any;
        if (typeof maybeAny?.toDate === "function") {
          const d = maybeAny.toDate();
          return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
        }
        return null;
      } catch {
        return null;
      }
    };

    try {
      // Check if user has a recently created Supabase integration
      const db = getAdminDb();

      if (!appIdHint) {
        return NextResponse.json({ completed: false, ok: false, error: "missing_appId" });
      }

      const integrationRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_apps")
        .doc(appIdHint)
        .collection("integrations")
        .doc("supabase");

      const setupRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_apps")
        .doc(appIdHint)
        .collection("integrations")
        .doc("supabase_setup");

      // `appIdHint` is now the sole source of truth — no need to persist it separately.

      // First: see if a setup status doc exists (helps surface failures while polling)
      const setupSnap = await setupRef.get();

      if (setupSnap.exists) {
        const setup = setupSnap.data() as any;
        const status = setup?.status as SupabaseSetupStatus | undefined;
        const step = typeof setup?.step === "string" ? setup.step : null;
        const updatedAt = setup?.updatedAt?.toDate?.() ?? setup?.updatedAt ?? null;
        const projectRef = typeof setup?.projectRef === "string" ? setup.projectRef : null;
        const hasFinalizeToken = Boolean(typeof setup?.finalizeToken === "string" && setup.finalizeToken);
        const hasAccessToken = Boolean(setup?.accessToken);

        if (status === "FAILED") {
          return NextResponse.json({
            completed: true,
            ok: false,
            error: setup?.error || "unknown_error",
            step,
            status,
            projectRef,
            projectId: setup?.projectId || null,
            lastSupabasePollError: setup?.lastSupabasePollError || null,
            hasFinalizeToken,
            hasAccessToken,
          });
        }

        if (status === "IN_PROGRESS") {
          // If we already have a projectRef, poll Supabase status and complete
          // integration once it becomes ACTIVE.
          const projectRef = typeof setup?.projectRef === "string" ? setup.projectRef.trim() : "";
          const encryptedAccessToken = setup?.accessToken as EncryptedBlobV1 | undefined;

          // If callback stored tokens but the popup never successfully called finalize,
          // auto-trigger project creation from this polling endpoint.
          if (allowAutoFinalize && !projectRef && step === "FINALIZE_READY" && hasFinalizeToken && encryptedAccessToken) {
              const finalizeToken = typeof setup?.finalizeToken === "string" ? setup.finalizeToken : "";
              if (finalizeToken) {
                const claimed = await db.runTransaction(async (tx) => {
                  const snap = await tx.get(setupRef);
                  const cur = snap.exists ? (snap.data() as any) : null;
                  if (!cur) return false;
                  const curStatus = cur?.status as SupabaseSetupStatus | undefined;
                  const curStep = typeof cur?.step === "string" ? cur.step : null;
                  const curToken = typeof cur?.finalizeToken === "string" ? cur.finalizeToken : "";
                  const curProjectRef = typeof cur?.projectRef === "string" ? cur.projectRef.trim() : "";
                  if (curStatus !== "IN_PROGRESS" || curStep !== "FINALIZE_READY" || !curToken || curToken !== finalizeToken || curProjectRef) {
                    return false;
                  }
                  tx.set(
                    setupRef,
                    {
                      finalizeToken: null,
                      step: "FINALIZE_START",
                      provisioningStartedAt: new Date(),
                      updatedAt: new Date(),
                    },
                    { merge: true }
                  );
                  return true;
                });

                if (claimed) {
                  try {
                    const accessToken = decryptString(encryptedAccessToken);

                    await setupRef.set({ step: "FETCH_ORG", updatedAt: new Date() }, { merge: true });
                    const organizationSlug = await getOrCreateOrganizationSlug(accessToken);

                    await setupRef.set(
                      { step: "SELECT_REGION", organizationSlug, updatedAt: new Date() },
                      { merge: true }
                    );
                    const regionSelection = await getRecommendedRegionSelection(accessToken, organizationSlug);

                    await setupRef.set(
                      { step: "CREATE_PROJECT", regionSelection, updatedAt: new Date() },
                      { merge: true }
                    );

                    const projectResponse = await fetch("https://api.supabase.com/v1/projects", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        name: normalizeProjectName(uid),
                        db_pass: generateSecurePassword(),
                        organization_slug: organizationSlug,
                        region_selection: regionSelection,
                      }),
                      signal: AbortSignal.timeout(90_000),
                    });

                    if (!projectResponse.ok) {
                      const bodyText = await projectResponse.text().catch(() => "");
                      throw new Error(`Project creation failed: ${projectResponse.status}${bodyText ? `\n${bodyText}` : ""}`);
                    }

                    const project: SupabaseProject = await projectResponse.json();
                    const createdRef = project.ref || (project as any).ref;
                    if (!createdRef || typeof createdRef !== "string") {
                      throw new Error("Project creation succeeded but returned no project ref.");
                    }

                    await setupRef.set(
                      {
                        provider: "supabase",
                        status: "IN_PROGRESS" satisfies SupabaseSetupStatus,
                        organizationSlug,
                        projectId: normalizeId(project.id),
                        projectRef: createdRef,
                        projectName: project.name,
                        regionSelection,
                        step: "WAIT_ACTIVE",
                        waitActiveStartedAt: new Date(),
                        updatedAt: new Date(),
                      },
                      { merge: true }
                    );
                  } catch (e: any) {
                    const msg = typeof e?.message === "string" ? e.message : "unknown_error";
                    await setupRef.set(
                      {
                        provider: "supabase",
                        status: "FAILED" satisfies SupabaseSetupStatus,
                        error: msg,
                        step: "FAILED",
                        updatedAt: new Date(),
                      },
                      { merge: true }
                    );

                    return NextResponse.json({
                      completed: true,
                      ok: false,
                      error: msg,
                      step: "FAILED",
                      status: "FAILED",
                      projectRef: "",
                      hasFinalizeToken: false,
                      hasAccessToken: Boolean(encryptedAccessToken),
                    });
                  }
                }
              }
            }

          if (!projectRef) {
            return NextResponse.json({
              completed: false,
              ok: true,
              inProgress: true,
              step,
              updatedAt,
              status,
              projectRef,
              projectId: setup?.projectId || null,
              hasFinalizeToken,
              hasAccessToken,
            });
          }

          if (projectRef && encryptedAccessToken) {
            try {
              const accessToken = decryptString(encryptedAccessToken);
              const storedProjectId = normalizeId(setup?.projectId);

              const tryGetProject = async (refOrId: string) => {
                const key = (refOrId || "").trim();
                const res = await fetch(`https://api.supabase.com/v1/projects/${key}` as string, {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                  cache: "no-store",
                  signal: AbortSignal.timeout(30_000),
                });
                return res;
              };

              // Prefer the stored projectRef, but fall back to projectId if ref lookup fails.
              let usedLookupKey: "ref" | "id" = "ref";
              let res = await tryGetProject(projectRef);
              if (!res.ok && res.status === 404 && storedProjectId && storedProjectId !== projectRef) {
                const alt = await tryGetProject(storedProjectId);
                if (alt.ok) {
                  usedLookupKey = "id";
                  res = alt;
                }
              }

              if (res.ok) {
                const project: any = await res.json();
                const remoteStatus = typeof project?.status === "string" ? project.status : "UNKNOWN";

                // If we managed to fetch via projectId, ensure we have the correct ref persisted.
                const fetchedRef = typeof project?.ref === "string" ? project.ref.trim() : "";
                if (fetchedRef && fetchedRef !== projectRef) {
                  await setupRef.set({ projectRef: fetchedRef, updatedAt: new Date() }, { merge: true });
                }

                if (remoteStatus === "FAILED") {
                  await setupRef.set(
                    {
                      provider: "supabase",
                      status: "FAILED" satisfies SupabaseSetupStatus,
                      error: "Project creation failed",
                      updatedAt: new Date(),
                    },
                    { merge: true }
                  );

                  return NextResponse.json({ completed: true, ok: false, error: "Project creation failed" });
                }

                if (isActiveStatus(remoteStatus)) {
                  // Fetch anon and service role keys from Supabase Management API
                  let anonKey = "";
                  let serviceRoleKey = "";
                  try {
                    const apiKeysRes = await fetch(`https://api.supabase.com/v1/projects/${fetchedRef || projectRef}/api-keys`, {
                      headers: { Authorization: `Bearer ${accessToken}` },
                      cache: "no-store",
                      signal: AbortSignal.timeout(30_000),
                    });
                    if (apiKeysRes.ok) {
                      const apiKeys = await apiKeysRes.json().catch(() => null);
                      const items = Array.isArray(apiKeys) ? apiKeys : Array.isArray(apiKeys?.keys) ? apiKeys.keys : [];
                      for (const it of items) {
                        const name = String(it?.name || it?.type || it?.key_name || "").toLowerCase();
                        const val = it?.api_key || it?.key || it?.value || it?.secret || "";
                        if ((name.includes("anon") || name.includes("public") || name.includes("publishable")) && typeof val === "string" && val.trim()) anonKey = val.trim();
                        if ((name.includes("service") || name.includes("service_role") || name.includes("service-role")) && typeof val === "string" && val.trim()) serviceRoleKey = val.trim();
                      }
                    }
                  } catch {}

                  // Write the integration doc now that the project is live.
                  await integrationRef.set(
                    {
                      provider: "supabase",
                      status: remoteStatus,
                      projectId: normalizeId(setup?.projectId) || normalizeId(project?.id) || null,
                      projectRef: fetchedRef || projectRef,
                      projectName: setup?.projectName || project?.name || null,
                      supabaseUrl: `https://${(fetchedRef || projectRef)}.supabase.co`,
                      databaseUrl: null,
                      anonKey: anonKey ? encryptString(anonKey) : null,
                      serviceRoleKey: serviceRoleKey ? encryptString(serviceRoleKey) : null,
                      accessToken: encryptedAccessToken,
                      refreshToken: setup?.refreshToken || null,
                      tokenExpiresAt: toValidDateOrNull(setup?.tokenExpiresAt),

                      `# Do not commit this file; do not deploy secrets from here.`,
                      `NEXT_PUBLIC_SUPABASE_URL=https://${fetchedRef || projectRef}.supabase.co`,
                      `SUPABASE_URL=https://${fetchedRef || projectRef}.supabase.co`,
                      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
                      `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
                      ""
                    ].join("\n");
                    const appRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
                    const appSnap = await appRef.get();
                    const prevFiles = appSnap.exists && appSnap.data()?.files ? appSnap?.data()?.files : {};
                    const newFiles = {
                      ...prevFiles,
                      [".env.local"]: {
                        content: envContent,
                        lastModified: Date.now(),
                      }
                    };
                    await appRef.set({ files: newFiles }, { merge: true });
                    console.log(`[supabase/project-status] .env.local written for appId=${appId}`);
                  }

                  await setupRef.set(
                    {
                      provider: "supabase",
                      status: "COMPLETED" satisfies SupabaseSetupStatus,
                      updatedAt: new Date(),
                    },
                    { merge: true }
                  );

                  return NextResponse.json({
                    completed: true,
                    ok: true,
                    project: {
                      id: normalizeId(setup?.projectId) || normalizeId(project?.id) || null,
                      name: setup?.projectName || project?.name || null,
                      status: remoteStatus,
                    },
                  });
                }

                return NextResponse.json({
                  completed: false,
                  ok: true,
                  inProgress: true,
                  remoteStatus,
                  step,
                  updatedAt,
                  status,
                  projectRef: fetchedRef || projectRef,
                  hasFinalizeToken,
                  hasAccessToken,
                });
              }

              // If Supabase API call fails, don't fail the whole flow; keep polling.
              const bodyText = await res.text().catch(() => "");
              const requestId = res.headers.get("x-request-id") || res.headers.get("x-supabase-request-id") || "";

              // IMPORTANT: Firestore rejects `undefined` values (including nested fields),
              // so we must only include keys that have concrete values.
              const pollErr: SupabasePollError = {
                httpStatus: res.status,
                at: new Date().toISOString(),
                ...(bodyText ? { body: String(bodyText).slice(0, 1200) } : {}),
                ...(requestId ? { requestId } : {}),
              };

              const nowMs = Date.now();
              const waitActiveStartedAtMs =
                setup?.waitActiveStartedAt?.toDate?.()?.getTime?.() ??
                (setup?.waitActiveStartedAt instanceof Date ? setup.waitActiveStartedAt.getTime() : 0);
              const notFoundFirstAtMs = typeof setup?.notFoundFirstAtMs === "number" ? setup.notFoundFirstAtMs : 0;
              const lastPollErrorPersistedAtMs =
                typeof setup?.lastPollErrorPersistedAtMs === "number" ? setup.lastPollErrorPersistedAtMs : 0;
              const shouldPersistPollErr = !lastPollErrorPersistedAtMs || nowMs - lastPollErrorPersistedAtMs > 30_000;

              // Persist error info occasionally so clients can show it, and so we can stop endless polling.
              if (shouldPersistPollErr) {
                const patch: any = {
                  lastSupabasePollError: pollErr,
                  lastPollErrorPersistedAtMs: nowMs,
                  updatedAt: new Date(),
                };
                if (res.status === 404) {
                  patch.notFoundFirstAtMs = notFoundFirstAtMs || nowMs;
                  patch.notFoundCount = (typeof setup?.notFoundCount === "number" ? setup.notFoundCount : 0) + 1;
                }
                await setupRef.set(patch, { merge: true });
              }

              // Hard-stop conditions:
              // - Supabase returns 404 for a sustained period: very unlikely to resolve by waiting.
              // - Provisioning has been in WAIT_ACTIVE too long.
              if (res.status === 404) {
                const firstAt = notFoundFirstAtMs || nowMs;
                const notFoundMs = nowMs - firstAt;
                const shouldFailNotFound = notFoundMs > 5 * 60_000;
                if (shouldFailNotFound) {
                  const msg = "Supabase returned 404 Project not found. This usually means the OAuth token cannot access the project/org, or the project was never created.";
                  await setupRef.set(
                    {
                      provider: "supabase",
                      status: "FAILED" satisfies SupabaseSetupStatus,
                      step: "FAILED",
                      error: msg,
                      lastSupabasePollError: pollErr,
                      updatedAt: new Date(),
                    },
                    { merge: true }
                  );

                  return NextResponse.json({
                    completed: true,
                    ok: false,
                    error: msg,
                    step: "FAILED",
                    status: "FAILED",
                    projectRef,
                    projectId: setup?.projectId || null,
                    lastSupabasePollError: pollErr,
                    hasFinalizeToken,
                    hasAccessToken,
                  });
                }
              }

              if (step === "WAIT_ACTIVE" && waitActiveStartedAtMs && nowMs - waitActiveStartedAtMs > 20 * 60_000) {
                const msg = "Supabase provisioning timed out while waiting for ACTIVE.";
                await setupRef.set(
                  {
                    provider: "supabase",
                    status: "FAILED" satisfies SupabaseSetupStatus,
                    step: "FAILED",
                    error: msg,
                    lastSupabasePollError: pollErr,
                    updatedAt: new Date(),
                  },
                  { merge: true }
                );

                return NextResponse.json({
                  completed: true,
                  ok: false,
                  error: msg,
                  step: "FAILED",
                  status: "FAILED",
                  projectRef,
                  projectId: setup?.projectId || null,
                  lastSupabasePollError: pollErr,
                  hasFinalizeToken,
                  hasAccessToken,
                });
              }

              // If the project lookup returns 404, try to recover by scanning the project list once in a while.
              // This helps if we accidentally stored an id where a ref is expected, or if Supabase returns a different ref.
              if (res.status === 404) {
                const lastLookupAt = typeof setup?.lastProjectListLookupAt === "number" ? setup.lastProjectListLookupAt : 0;
                const nowMs = Date.now();
                const shouldList = !lastLookupAt || nowMs - lastLookupAt > 45_000;

                if (shouldList) {
                  try {
                    await setupRef.set({ lastProjectListLookupAt: nowMs }, { merge: true });
                    const listRes = await fetch("https://api.supabase.com/v1/projects", {
                      headers: { Authorization: `Bearer ${accessToken}` },
                      cache: "no-store",
                      signal: AbortSignal.timeout(30_000),
                    });

                    if (listRes.ok) {
                      const list: any = await listRes.json().catch(() => null);
                      const projects = Array.isArray(list) ? list : [];
                      const targetId = typeof setup?.projectId === "string" ? setup.projectId.trim() : "";
                      // If projectId was stored as a number, ensure we can still match.
                      const targetIdNormalized = targetId || normalizeId(setup?.projectId);
                      const targetName = typeof setup?.projectName === "string" ? setup.projectName.trim() : "";

                      const match =
                        (targetIdNormalized ? projects.find((p: any) => String(p?.id || "").trim() === targetIdNormalized) : null) ||
                        (targetName ? projects.find((p: any) => String(p?.name || "").trim() === targetName) : null);

                      const recoveredRef = match && typeof match?.ref === "string" ? match.ref.trim() : "";
                      const recoveredId = normalizeId(match?.id);
                      const recoveredName = match && typeof match?.name === "string" ? match.name : null;
                      const recoveredStatus = match && typeof match?.status === "string" ? match.status : "";

                      if (recoveredRef && recoveredRef !== projectRef) {
                        await setupRef.set(
                          { projectRef: recoveredRef, projectId: recoveredId || normalizeId(setup?.projectId) || null, updatedAt: new Date() },
                          { merge: true }
                        );
                      }

                      // If we can find the project in the list, use its status as source-of-truth
                      // even if GET /v1/projects/{ref} is returning 404.
                      if (recoveredStatus) {
                        if (isActiveStatus(recoveredStatus)) {
                          await integrationRef.set(
                            {
                              provider: "supabase",
                              status: recoveredStatus,
                              projectId: recoveredId || normalizeId(setup?.projectId) || null,
                              projectRef: recoveredRef || projectRef,
                              projectName: recoveredName || setup?.projectName || null,
                              supabaseUrl: `https://${(recoveredRef || projectRef)}.supabase.co`,
                              databaseUrl: null,
                              anonKey: null,
                              serviceRoleKey: null,
                              accessToken: encryptedAccessToken,
                              refreshToken: setup?.refreshToken || null,
                              tokenExpiresAt: toValidDateOrNull(setup?.tokenExpiresAt),
                              updatedAt: new Date(),
                              createdAt: new Date(),
                            },
                            { merge: true }
                          );

                          await setupRef.set(
                            {
                              provider: "supabase",
                              status: "COMPLETED" satisfies SupabaseSetupStatus,
                              updatedAt: new Date(),
                            },
                            { merge: true }
                          );

                          return NextResponse.json({
                            completed: true,
                            ok: true,
                            project: {
                              id: recoveredId || normalizeId(setup?.projectId) || null,
                              name: recoveredName || setup?.projectName || null,
                              status: recoveredStatus,
                            },
                          });
                        }

                        return NextResponse.json({
                          completed: false,
                          ok: true,
                          inProgress: true,
                          remoteStatus: recoveredStatus,
                          step,
                          updatedAt,
                          status,
                          projectRef: recoveredRef || projectRef,
                          projectId: recoveredId || normalizeId(setup?.projectId) || null,
                          hasFinalizeToken,
                          hasAccessToken,
                          recoveredFromProjectList: true,
                        });
                      }

                      if (recoveredRef && recoveredRef !== projectRef) {
                        return NextResponse.json({
                          completed: false,
                          ok: true,
                          inProgress: true,
                          step,
                          updatedAt,
                          status,
                          projectRef: recoveredRef,
                          projectId: recoveredId || normalizeId(setup?.projectId) || null,
                          hasFinalizeToken,
                          hasAccessToken,
                          recoveredProjectRef: true,
                        });
                      }
                    } else {
                      const listBody = await listRes.text().catch(() => "");
                      console.warn(
                        `[supabase] project list lookup failed: ${listRes.status}${listBody ? `\n${String(listBody).slice(0, 800)}` : ""}`
                      );
                    }
                  } catch (e) {
                    console.warn("[supabase] project list lookup threw:", e);
                  }
                }
              }

              console.warn(
                `[supabase] project status poll failed for uid=${uid} ref=${projectRef} id=${storedProjectId || ""} lookup=${usedLookupKey}: ${res.status}${bodyText ? `\n${String(bodyText).slice(0, 800)}` : ""}`
              );

              return NextResponse.json({
                completed: false,
                ok: true,
                inProgress: true,
                step,
                updatedAt,
                status,
                projectRef,
                projectId: setup?.projectId || null,
                hasFinalizeToken,
                hasAccessToken,
                lastSupabasePollError: pollErr,
              });
            } catch (e) {
              console.warn("Supabase project status poll threw:", e);
            }
          }

          return NextResponse.json({
            completed: false,
            ok: true,
            inProgress: true,
            step,
            updatedAt,
            status,
            projectRef,
            projectId: setup?.projectId || null,
            hasFinalizeToken,
            hasAccessToken,
          });
        }
      }

      const integrationSnap = await integrationRef.get();

        if (integrationSnap.exists) {
          const project = integrationSnap.data() as any;
          return NextResponse.json({
            completed: true,
            ok: true,
            project: {
              id: project.projectId,
              name: project.projectName,
              status: project.status,
            }
          });
        }

      return NextResponse.json({ completed: false });
    } catch (error) {
      console.error('Error checking project status:', error);
      return NextResponse.json({
        completed: true,
        ok: false,
        error: 'Failed to check project status',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }

  // Token-based polling for the OAuth popup/tab.
  try {
    const url = new URL(request.url);
    const tokenUid = url.searchParams.get("uid");
    const statusToken = url.searchParams.get("statusToken");
    const tokenAppId = url.searchParams.get("appId")?.trim() || "";

    if (tokenUid && statusToken && tokenAppId) {
      const db = getAdminDb();
      const setupRef = db
        .collection("kloner_users")
        .doc(tokenUid)
        .collection("kloner_apps")
        .doc(tokenAppId)
        .collection("integrations")
        .doc("supabase_setup");
      const snap = await setupRef.get();
      const setup = snap.exists ? (snap.data() as any) : null;
      const stored = typeof setup?.statusToken === "string" ? setup.statusToken : "";
      if (!stored || stored !== statusToken) {
        return NextResponse.json(
          { completed: true, ok: false, error: "unauthorized" },
          { status: 401 }
        );
      }

      return computeStatus({ uid: tokenUid, allowAutoFinalize: false });
    }
  } catch {
    // fall through to session-based flow
  }

  // Normal polling from the main app (requires a valid session)
      return requireSessionAndMaybeCsrf(
    request,
    async ({ uid }) => computeStatus({ uid, allowAutoFinalize: true, appIdHint: hintedAppId || undefined }),
    { csrf: false, methods: ['GET'] }
  );
}