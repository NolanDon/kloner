// app/api/supabase/oauth/finalize/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { decryptString, EncryptedBlobV1 } from "../../../_lib/crypto";

type SupabaseSetupStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

type SupabaseRegionSelection =
  | { type: "smartGroup"; code: "americas" | "emea" | "apac" }
  | { type: "specific"; code: string };

interface SupabaseProject {
  id: string | number;
  name: string;
  ref?: string;
  status: string;
}

function normalizeProjectId(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function toValidDateOrNull(v: unknown): Date | null {
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
    const anyV: any = v as any;
    if (typeof anyV?.toDate === "function") {
      const d = anyV.toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
  } catch {
    return null;
  }
}

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
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
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
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(30_000),
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
    console.warn("Supabase available-regions lookup threw:", e);
    return { type: "smartGroup", code: "americas" };
  }
}

export async function POST(request: NextRequest) {
    console.log('[supabase/oauth/finalize] Handler invoked');
      try {
        const body = await request.json().catch(() => ({} as any));
        console.log('[supabase/oauth/finalize] Request body:', JSON.stringify(body));
      } catch (e) {
        console.error('[supabase/oauth/finalize] Failed to parse request body:', e);
      }
  const db = getAdminDb();

  let uid = "";

  try {
    const body = await request.json().catch(() => ({} as any));
    uid = typeof body?.uid === "string" ? body.uid : "";
    const finalizeToken = typeof body?.finalizeToken === "string" ? body.finalizeToken : "";

    if (!uid) {
      return NextResponse.json({ ok: false, error: "missing_uid" }, { status: 400 });
    }

    if (!finalizeToken) {
      console.error('[supabase/oauth/finalize] Missing finalizeToken');
      return NextResponse.json({ ok: false, error: "missing_finalize_token" }, { status: 400 });
    }

    const setupRef = db
      .collection("kloner_users")
      .doc(uid)
      .collection("integrations")
      .doc("supabase_setup");

      const setupSnap = await setupRef.get();
      const setup = setupSnap.exists ? (setupSnap.data() as any) : null;
      const storedToken = typeof setup?.finalizeToken === "string" ? setup.finalizeToken : "";

    if (!setup || !storedToken || storedToken !== finalizeToken) {
      console.error('[supabase/oauth/finalize] Invalid or missing setup/finalizeToken', { setup, storedToken, finalizeToken });
      return NextResponse.json({ ok: false, error: "invalid_finalize_token" }, { status: 403 });
    }

      const encryptedAccessToken = setup?.accessToken as EncryptedBlobV1 | undefined;
      const encryptedRefreshToken = setup?.refreshToken as EncryptedBlobV1 | undefined;

    if (!encryptedAccessToken) {
      console.error('[supabase/oauth/finalize] Missing encryptedAccessToken');
      return NextResponse.json({ ok: false, error: "missing_supabase_access_token" }, { status: 400 });
    }

    // One-time token: clear it first to prevent double-submits/replay.
    await setupRef.set(
      {
        finalizeToken: null,
        status: "IN_PROGRESS" satisfies SupabaseSetupStatus,
        step: "FINALIZE_START",
        provisioningStartedAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );

      const accessToken = decryptString(encryptedAccessToken);

    await setupRef.set(
      { step: "FETCH_ORG", updatedAt: new Date() },
      { merge: true }
    );
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
    const projectRef = project.ref || (project as any).ref;
    if (!projectRef || typeof projectRef !== "string") {
      throw new Error("Project creation succeeded but returned no project ref.");
    }

    const projectId = normalizeProjectId(project.id);
    const createRequestId =
      projectResponse.headers.get("x-request-id") ||
      projectResponse.headers.get("x-supabase-request-id") ||
      null;

        // Persist projectRef so the polling endpoint can finish setup without
        // keeping this request open (important for serverless timeouts).
    await setupRef.set(
      {
        provider: "supabase",
        status: "IN_PROGRESS" satisfies SupabaseSetupStatus,
        organizationSlug,
        projectId,
        projectRef,
        projectName: project.name,
        regionSelection,
        step: "WAIT_ACTIVE",
        waitActiveStartedAt: new Date(),
        createProjectRequestId: createRequestId,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    // IMPORTANT: also write the integration doc immediately.
    // Users may close the OAuth popout early; the main app + migrations need
    // to see that Supabase is connected, even while provisioning continues.
    const integrationRef = db
      .collection("kloner_users")
      .doc(uid)
      .collection("integrations")
      .doc("supabase");

    // Use the appId that was stored in the setup doc when OAuth was initiated for this specific app.
    // This ensures strict 1:1 binding between each Kloner app and its Supabase project.
    const appId = typeof setup?.appId === "string" && setup.appId.trim() ? setup.appId.trim() : null;
    if (appId) {
      console.log(`[supabase/oauth/finalize] Using appId from setup doc: ${appId}`);
    } else {
      console.warn(`[supabase/oauth/finalize] No appId in setup doc for user ${uid} — .env.local will not be written`);
    }

    await integrationRef.set(
      {
        provider: "supabase",
        mode: "oauth",
        status: typeof project.status === "string" ? project.status : "UNKNOWN",
        projectId: projectId || null,
        projectRef,
        projectName: project.name || null,
        supabaseUrl: `https://${projectRef}.supabase.co`,
        databaseUrl: null,
        anonKey: null,
        serviceRoleKey: null,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken || null,
        tokenExpiresAt: toValidDateOrNull(setup?.tokenExpiresAt),
        // Bind this integration to the specific Kloner app that initiated the OAuth flow.
        boundAppId: appId || null,
        updatedAt: new Date(),
        createdAt: new Date(),
      },
      { merge: true }
    );
    if (appId) {
      const envContent = [
        `# Generated by Kloner (preview-only)`,
        `# Do not commit this file; do not deploy secrets from here.`,
        `NEXT_PUBLIC_SUPABASE_URL=https://${projectRef}.supabase.co`,
        `SUPABASE_URL=https://${projectRef}.supabase.co`,
        // anonKey and serviceRoleKey will be filled in later after provisioning completes
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=`,
        `SUPABASE_SERVICE_ROLE_KEY=`,
        ""
      ].join("\n");
      const appRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
      const appSnap = await appRef.get();
      if (!appSnap.exists) {
        console.error(`[supabase/oauth/finalize] kloner_apps doc for appId ${appId} does not exist!`);
      } else {
        console.log(`[supabase/oauth/finalize] kloner_apps doc for appId ${appId} found, writing .env.local`);
      }
      const prevFiles = appSnap.exists && appSnap.data()?.files ? appSnap?.data()?.files : {};
      const newFiles = {
        ...prevFiles,
        [".env.local"]: {
          content: envContent,
          lastModified: Date.now(),
        }
      };
      await appRef.set({ files: newFiles }, { merge: true });
      console.log(`[supabase/oauth/finalize] .env.local written for appId=${appId}`);
    } else {
      console.error(`[supabase/oauth/finalize] Could not determine appId for user ${uid}, .env.local not written!`);
    }
    console.log('[supabase/oauth/finalize] Handler completed');

    return NextResponse.json({ ok: true, projectRef, provisioning: true });
  } catch (e: any) {
    const details = typeof e?.message === "string" ? e.message : "unknown_error";

    // Best-effort: if uid was provided, mark setup as failed.
    if (uid) {
      try {
        await db
          .collection("kloner_users")
          .doc(uid)
          .collection("integrations")
          .doc("supabase_setup")
          .set(
            {
              provider: "supabase",
              status: "FAILED" satisfies SupabaseSetupStatus,
              error: details,
              updatedAt: new Date(),
            },
            { merge: true }
          );
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ ok: false, error: details }, { status: 500 });
  }
}
