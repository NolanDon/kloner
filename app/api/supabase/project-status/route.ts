// app/api/supabase/project-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndMaybeCsrf } from '../../_lib/route-guard';
import { getAdminDb } from '../../_lib/auth';
import { decryptString, EncryptedBlobV1 } from '../../_lib/crypto';

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
  return requireSessionAndMaybeCsrf(
    request,
    async ({ uid, req: authedReq }) => {
      try {
        // Check if user has a recently created Supabase integration
        const db = getAdminDb();

        const integrationRef = db
          .collection("kloner_users")
          .doc(uid)
          .collection("integrations")
          .doc("supabase");

        const setupRef = db
          .collection("kloner_users")
          .doc(uid)
          .collection("integrations")
          .doc("supabase_setup");

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
            if (!projectRef && step === "FINALIZE_READY" && hasFinalizeToken && encryptedAccessToken) {
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
                        projectId: project.id,
                        projectRef: createdRef,
                        projectName: project.name,
                        regionSelection,
                        step: "WAIT_ACTIVE",
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
                hasFinalizeToken,
                hasAccessToken,
              });
            }

            if (projectRef && encryptedAccessToken) {
              try {
                const accessToken = decryptString(encryptedAccessToken);
                const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}` as string, {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                  cache: "no-store",
                });

                if (res.ok) {
                  const project: any = await res.json();
                  const remoteStatus = typeof project?.status === "string" ? project.status : "UNKNOWN";

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

                  if (remoteStatus === "ACTIVE") {
                    // Write the integration doc now that the project is live.
                    await integrationRef.set(
                      {
                        provider: "supabase",
                        status: remoteStatus,
                        projectId: setup?.projectId || project?.id || null,
                        projectRef,
                        projectName: setup?.projectName || project?.name || null,
                        supabaseUrl: `https://${projectRef}.supabase.co`,
                        databaseUrl: null,
                        anonKey: null,
                        serviceRoleKey: null,
                        accessToken: encryptedAccessToken,
                        refreshToken: setup?.refreshToken || null,
                        tokenExpiresAt: setup?.tokenExpiresAt ? new Date(setup.tokenExpiresAt) : null,
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
                        id: setup?.projectId || project?.id || null,
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
                    projectRef,
                    hasFinalizeToken,
                    hasAccessToken,
                  });
                }

                // If Supabase API call fails, don't fail the whole flow; keep polling.
                const bodyText = await res.text().catch(() => "");
                console.warn(`Supabase project status poll failed: ${res.status}${bodyText ? `\n${bodyText}` : ""}`);
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
          error: 'Failed to check project status',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
      }
    },
    { csrf: false, methods: ['GET'] }
  );
}