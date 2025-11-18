// app/site/[siteId]/page.tsx
import admin from "firebase-admin";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SiteRenderer } from "@/components/site/SiteRenderer";
import { safeSiteConfig, type SiteConfig } from "@/lib/siteConfig";

export const runtime = "nodejs";

// Minimal admin init – reuse the same pattern you use in billing/webhooks
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT missing for SitePage");
    }

    let credJson: admin.ServiceAccount;
    try {
        credJson = JSON.parse(raw); // plain JSON in env
    } catch {
        const decoded = Buffer.from(raw, "base64").toString("utf8"); // base64-encoded JSON
        credJson = JSON.parse(decoded);
    }

    admin.initializeApp({
        credential: admin.credential.cert(credJson),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
}

/**
 * Derive UID from your Firebase session cookie.
 * Adjust the cookie name to whatever you actually set (e.g. "__session", "session", etc).
 */
async function getUidFromSessionCookie(): Promise<string> {
    const cookieStore = cookies();
    const sessionCookie = cookieStore.get("__session")?.value; // <-- rename if needed

    if (!sessionCookie) {
        redirect("/login");
    }

    try {
        const decoded = await admin
            .auth()
            .verifySessionCookie(sessionCookie, true);
        return decoded.uid;
    } catch {
        redirect("/login");
    }
}

type Props = {
    params: { siteId: string };
};

async function loadSiteConfigForUser(siteId: string): Promise<{
    config: SiteConfig;
    overridesCss: string;
}> {
    const uid = await getUidFromSessionCookie();

    const fs = admin.firestore();
    const docRef = fs
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_sites")
        .doc(siteId);

    const snap = await docRef.get();
    if (!snap.exists) {
        redirect("/404");
    }

    const data = snap.data() || {};
    const rawConfig = data.siteConfig;
    const config = safeSiteConfig(rawConfig);
    if (!config) {
        throw new Error("Invalid siteConfig stored in Firestore");
    }

    const overridesCss: string = data.siteOverridesCss || "";
    return { config, overridesCss };
}

export default async function SitePage({ params }: Props) {
    const { siteId } = params;
    const { config, overridesCss } = await loadSiteConfigForUser(siteId);

    return (
        <SiteRenderer
            config={config}
            overridesCss={overridesCss}
            siteId={siteId}
            disableNavigation
        />
    );
}
