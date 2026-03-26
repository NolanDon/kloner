// app/api/app-builder/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { DEFAULT_APP_TEMPLATE_FILES, DEFAULT_APP_TEMPLATE_VERSION } from "../_lib/default-app-template";
import { getAuthoritativeUserTier } from "../../_lib/userTier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fetch default template from Firebase. If not found, throw.
async function getDefaultTemplate(db: any) {
  const templateDoc = await db.collection("system").doc("default_app_template").get();
  if (!templateDoc.exists) {
    // Self-heal: write the canonical default template into Firestore.
    // This keeps a single template source of truth while avoiding manual setup in dev/new envs.
    await db.collection("system").doc("default_app_template").set(
      {
        files: DEFAULT_APP_TEMPLATE_FILES,
        updatedAt: new Date(),
        version: DEFAULT_APP_TEMPLATE_VERSION,
        source: "auto_seed",
      },
      { merge: true },
    );
    console.warn("[app-builder/create] system/default_app_template missing; auto-seeded default template");
    return DEFAULT_APP_TEMPLATE_FILES;
  }
  const templateData = templateDoc.data();
  if (!templateData?.files) {
    throw new Error("Default app template is missing 'files' property in Firestore.");
  }

  // If we previously auto-seeded the doc and the canonical template version has changed,
  // keep the Firestore doc in sync automatically.
  if (templateData?.source === "auto_seed" && templateData?.version !== DEFAULT_APP_TEMPLATE_VERSION) {
    await db.collection("system").doc("default_app_template").set(
      {
        files: DEFAULT_APP_TEMPLATE_FILES,
        updatedAt: new Date(),
        version: DEFAULT_APP_TEMPLATE_VERSION,
        source: "auto_seed",
      },
      { merge: true },
    );
    console.warn(
      `[app-builder/create] system/default_app_template auto-seeded version '${templateData?.version}' updated to '${DEFAULT_APP_TEMPLATE_VERSION}'`,
    );
    return DEFAULT_APP_TEMPLATE_FILES;
  }

  return templateData.files;
}

function ensureSupabaseJsDependencyInPackageJson(files: Record<string, { content: string }>) {
  try {
    const entry = (files as any)["package.json"];
    const raw = typeof entry?.content === "string" ? entry.content : "";
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const deps = (parsed && typeof parsed === "object" && (parsed as any).dependencies && typeof (parsed as any).dependencies === "object")
      ? (parsed as any).dependencies
      : {};

    if (typeof deps["@supabase/supabase-js"] === "string" && deps["@supabase/supabase-js"].trim()) {
      return;
    }

    (parsed as any).dependencies = { ...deps, "@supabase/supabase-js": "^2.49.0" };
    (files as any)["package.json"] = { content: JSON.stringify(parsed, null, 2) };
  } catch {
    // Ignore parse errors; don't block app creation.
  }
}

export async function POST(req: NextRequest) {
  return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
    const db = getAdminDb();

    let tier;
    try {
      tier = await getAuthoritativeUserTier(uid);
    } catch (e: any) {
      return NextResponse.json(
        {
          error: e?.message || "Unable to determine subscription tier. Try again shortly.",
        },
        { status: 500 },
      );
    }

    if (tier === "free") {
      return NextResponse.json(
        {
          error: "Upgrade to Pro to create websites or apps from the dashboard.",
          code: "APP_CREATE_TIER_BLOCKED",
          reason: "app_create_tier_blocked",
          requiredTiers: ["trialing", "pro", "agency"],
        },
        { status: 403 },
      );
    }

    const body = await req.json();
    const { name, renderId, prompt } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const appId = `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Load default template from Firebase (throws if not found)
    let initialFiles = await getDefaultTemplate(db);
    // Ensure common DB deps exist so the first Supabase connect doesn't fail with a missing module.
    ensureSupabaseJsDependencyInPackageJson(initialFiles as any);

    // If renderId is provided, generate initial content from the render
    if (renderId) {
      try {
        const renderDoc = await db.collection("renders").doc(renderId).get();
        if (renderDoc.exists) {
          const renderData = renderDoc.data();
          if (renderData?.userId === uid && renderData?.html) {
            // Generate basic Next.js app from HTML, but use the current template as base
            initialFiles = {
              ...initialFiles,
              "app/page.js": {
                content: `export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="kloner-shell">
      <div className="kloner-card">
        <div className="kloner-top">
          <div className="kloner-brand">
            <span className="kloner-dot" aria-hidden="true" />
            <span>Kloner</span>
          </div>
          <div className="kloner-meta">Imported render</div>
        </div>
        <div className="kloner-body">
          <div dangerouslySetInnerHTML={{ __html: \`${renderData.html.replace(/`/g, '\\`')}\` }} />
        </div>
      </div>
    </main>
  );
}`,
              },
            };
          }
        }
      } catch (error) {
        console.error("Failed to load render for app creation:", error);
        throw error;
      }
    }

    const files: Record<string, { content: string; lastModified: number }> = {};
    Object.entries(initialFiles as Record<string, { content: string }>).forEach(([path, { content }]) => {
      files[path] = { content, lastModified: Date.now() };
    });

    await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).set({
      id: appId,
      userId: uid,
      name,
      files,
      renderId: renderId || null, // Store reference to source render
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ appId });
  });
}