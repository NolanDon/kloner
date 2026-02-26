/**
 * Migration: Move Supabase integrations from user-scoped to app-scoped paths.
 *
 * OLD: kloner_users/{uid}/integrations/supabase
 *      kloner_users/{uid}/integrations/supabase_setup
 *
 * NEW: kloner_users/{uid}/kloner_apps/{appId}/integrations/supabase
 *      kloner_users/{uid}/kloner_apps/{appId}/integrations/supabase_setup
 *
 * Usage:
 *   DRY_RUN=true  node scripts/migrate-supabase-to-app-scoped.js   # preview only
 *   DRY_RUN=false node scripts/migrate-supabase-to-app-scoped.js   # actually migrate
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT env var
 * pointing at a service account key with Firestore read/write access.
 */

const admin = require("firebase-admin");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });

const DRY_RUN = process.env.DRY_RUN !== "false";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let serviceAccount = undefined;
  if (raw) {
    // Support both plain JSON and base64-encoded JSON
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      try {
        serviceAccount = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      } catch (e) {
        console.error("Could not parse FIREBASE_SERVICE_ACCOUNT:", e.message);
        process.exit(1);
      }
    }
  }

  admin.initializeApp(
    serviceAccount
      ? { credential: admin.credential.cert(serviceAccount) }
      : undefined // falls back to GOOGLE_APPLICATION_CREDENTIALS
  );
}

const db = admin.firestore();

async function copySubcollection(srcRef, destRef, dryRun) {
  const snap = await srcRef.listCollections();
  for (const coll of snap) {
    const docs = await coll.get();
    for (const doc of docs.docs) {
      const destDoc = destRef.collection(coll.id).doc(doc.id);
      console.log(`    copy subcollection doc: ${doc.ref.path} → ${destDoc.path}`);
      if (!dryRun) {
        await destDoc.set(doc.data(), { merge: true });
      }
    }
  }
}

async function migrateUser(uid) {
  const integrationsRef = db.collection("kloner_users").doc(uid).collection("integrations");

  const [supabaseSnap, setupSnap] = await Promise.all([
    integrationsRef.doc("supabase").get(),
    integrationsRef.doc("supabase_setup").get(),
  ]);

  if (!supabaseSnap.exists && !setupSnap.exists) return null; // nothing to migrate

  const supabaseData = supabaseSnap.exists ? supabaseSnap.data() : null;
  const setupData = setupSnap.exists ? setupSnap.data() : null;

  // Determine which appId this integration belongs to.
  const appId =
    (typeof supabaseData?.boundAppId === "string" && supabaseData.boundAppId.trim()
      ? supabaseData.boundAppId.trim()
      : null) ||
    (typeof setupData?.appId === "string" && setupData.appId.trim()
      ? setupData.appId.trim()
      : null);

  if (!appId) {
    console.warn(`  [SKIP] uid=${uid}: no appId found in boundAppId or supabase_setup.appId`);
    return "skipped";
  }

  // Verify the kloner_apps doc exists for this appId.
  const appDocSnap = await db
    .collection("kloner_users")
    .doc(uid)
    .collection("kloner_apps")
    .doc(appId)
    .get();

  if (!appDocSnap.exists) {
    console.warn(`  [SKIP] uid=${uid} appId=${appId}: kloner_apps doc does not exist`);
    return "skipped";
  }

  const newIntegrationsRef = db
    .collection("kloner_users")
    .doc(uid)
    .collection("kloner_apps")
    .doc(appId)
    .collection("integrations");

  // Copy supabase integration doc.
  if (supabaseData) {
    const { boundAppId: _dropped, ...dataWithoutBoundAppId } = supabaseData;
    const dest = newIntegrationsRef.doc("supabase");
    console.log(`  copy: ${supabaseSnap.ref.path} → ${dest.path}`);
    if (!DRY_RUN) {
      await dest.set(dataWithoutBoundAppId, { merge: true });
      // Copy migration_proposals subcollection if present.
      await copySubcollection(supabaseSnap.ref, dest, DRY_RUN);
    }
  }

  // Copy supabase_setup doc.
  if (setupData) {
    const dest = newIntegrationsRef.doc("supabase_setup");
    console.log(`  copy: ${setupSnap.ref.path} → ${dest.path}`);
    if (!DRY_RUN) {
      await dest.set(setupData, { merge: true });
    }
  }

  // Delete old docs (only after successful copy).
  if (!DRY_RUN) {
    await Promise.all([
      supabaseSnap.exists ? supabaseSnap.ref.delete() : Promise.resolve(),
      setupSnap.exists ? setupSnap.ref.delete() : Promise.resolve(),
    ]);
    console.log(`  deleted old docs for uid=${uid}`);
  }

  return appId;
}

async function main() {
  console.log(`\n=== Supabase integration migration (DRY_RUN=${DRY_RUN}) ===\n`);

  // Page through all kloner_users in batches of 100.
  let lastDoc = null;
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let pageNum = 0;

  while (true) {
    pageNum++;
    let q = db.collection("kloner_users").limit(100);
    if (lastDoc) q = q.startAfter(lastDoc);

    const page = await q.get();
    if (page.empty) break;

    console.log(`Page ${pageNum}: processing ${page.docs.length} users...`);

    for (const userDoc of page.docs) {
      const uid = userDoc.id;
      try {
        const result = await migrateUser(uid);
        if (result === null) {
          // no supabase integration — silent
        } else if (result === "skipped") {
          totalSkipped++;
        } else {
          console.log(`  [OK] uid=${uid} → appId=${result}`);
          totalMigrated++;
        }
      } catch (err) {
        console.error(`  [ERROR] uid=${uid}: ${err?.message || err}`);
        totalErrors++;
      }
    }

    lastDoc = page.docs[page.docs.length - 1];
    if (page.docs.length < 100) break;
  }

  console.log(`\n=== Done ===`);
  console.log(`Migrated: ${totalMigrated}`);
  console.log(`Skipped:  ${totalSkipped}`);
  console.log(`Errors:   ${totalErrors}`);
  if (DRY_RUN) {
    console.log(`\n(Dry run — no data was written or deleted.)`);
    console.log(`Re-run with DRY_RUN=false to apply.`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
