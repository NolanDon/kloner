// app/api/supabase/oauth/finalize/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { decryptString, EncryptedBlobV1 } from "../../../_lib/crypto";

type SupabaseSetupStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

type SupabaseRegionSelection =
  | { type: "smartGroup"; code: "americas" | "emea" | "apac" }
  | { type: "specific"; code: string };

interface SupabaseProject {
  id: string;
  name: string;
  ref?: string;
  status: string;
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
      return NextResponse.json({ ok: false, error: "invalid_finalize_token" }, { status: 403 });
    }

      const encryptedAccessToken = setup?.accessToken as EncryptedBlobV1 | undefined;
      const encryptedRefreshToken = setup?.refreshToken as EncryptedBlobV1 | undefined;

    if (!encryptedAccessToken) {
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

        // Persist projectRef so the polling endpoint can finish setup without
        // keeping this request open (important for serverless timeouts).
    await setupRef.set(
      {
        provider: "supabase",
        status: "IN_PROGRESS" satisfies SupabaseSetupStatus,
        organizationSlug,
        projectId: project.id,
        projectRef,
        projectName: project.name,
        regionSelection,
        step: "WAIT_ACTIVE",
        updatedAt: new Date(),
      },
      { merge: true }
    );

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
