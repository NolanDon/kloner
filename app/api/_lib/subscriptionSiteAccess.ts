import { Resend } from "resend";
import { getAdminDb } from "./auth";
import { loadVercelIntegration } from "./vercel-integration";
import { captureAuditEvent } from "@/lib/observability";

const SITE_ACCESS_FLAG = "STRIPE_ENFORCE_LIVE_SITE_ACCESS";

type ProjectRecord = {
    projectId: string;
    teamId?: string | null;
    projectName?: string | null;
    domains?: string[];
    detachedDomains?: string[];
    originalDeploymentId?: string | null;
    suspensionDeploymentId?: string | null;
};

export type SiteAccessJobOperation = "suspend" | "restore";

function getDb() {
    return getAdminDb();
}

async function getUserRootRef(uid: string): Promise<any> {
    const db = getDb();
    const legacy = db.collection("kloner_users").doc(uid);
    if ((await legacy.get()).exists) return legacy;
    return db.collection("users").doc(uid);
}

function readProjectDomains(project: any): string[] {
    const raw = Array.isArray(project?.domains) ? project.domains : [];
    return raw
        .map((domain: any) => typeof domain === "string" ? domain : domain?.name)
        .filter((domain: unknown): domain is string => typeof domain === "string" && domain.trim().length > 0)
        .map((domain: string) => domain.trim())
        .filter((domain: string, index: number, all: string[]) => all.indexOf(domain) === index);
}

function flagEnabled(value: string | undefined): boolean {
    return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function shouldEnforceLiveSiteAccess(): boolean {
    // Site protection is enabled by default. Set the flag to `false` only for
    // an intentional local/test opt-out.
    const configured = process.env[SITE_ACCESS_FLAG];
    return configured === undefined ? true : flagEnabled(configured);
}

function teamQuery(teamId?: string | null): string {
    return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function getVercelProject(params: {
    accessToken: string;
    projectId: string;
    teamId?: string | null;
}): Promise<any | null> {
    const res = await fetch(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(params.projectId)}${teamQuery(params.teamId)}`,
        {
            headers: { Authorization: `Bearer ${params.accessToken}` },
            signal: AbortSignal.timeout(30_000),
        },
    );
    if (!res.ok) return null;
    return res.json().catch(() => null);
}

async function getLatestProductionDeployment(params: {
    accessToken: string;
    projectId: string;
    teamId?: string | null;
}): Promise<string | null> {
    const query = new URLSearchParams({ projectId: params.projectId, target: "production", limit: "1" });
    if (params.teamId) query.set("teamId", params.teamId);
    const res = await fetch(`https://api.vercel.com/v7/deployments?${query.toString()}`, {
        headers: { Authorization: `Bearer ${params.accessToken}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return typeof body?.deployments?.[0]?.uid === "string"
        ? body.deployments[0].uid
        : typeof body?.deployments?.[0]?.id === "string" ? body.deployments[0].id : null;
}

const BLANK_SITE_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title></title></head><body></body></html>";

async function deployBlankSite(params: { accessToken: string; projectId: string; teamId?: string | null; projectName?: string | null }): Promise<string> {
    const queryParams = new URLSearchParams({ skipAutoDetectionConfirmation: "1" });
    if (params.teamId) queryParams.set("teamId", params.teamId);
    const files = [
        { file: "index.html", data: Buffer.from(BLANK_SITE_HTML).toString("base64"), encoding: "base64" },
        { file: "vercel.json", data: Buffer.from(JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/index.html" }] })).toString("base64"), encoding: "base64" },
    ];
    const res = await fetch(`https://api.vercel.com/v13/deployments?${queryParams.toString()}`, {
        method: "POST", headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: params.projectName || params.projectId, project: params.projectId, target: "production", files, projectSettings: { framework: null, buildCommand: null, devCommand: null, outputDirectory: null } }),
        signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body?.id !== "string") {
        throw new Error(`Blank deployment failed (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
    }
    await waitForDeployment({ accessToken: params.accessToken, teamId: params.teamId, deploymentId: body.id });
    await promoteDeployment({ accessToken: params.accessToken, projectId: params.projectId, teamId: params.teamId, deploymentId: body.id });
    const currentProductionId = await getLatestProductionDeployment({ accessToken: params.accessToken, projectId: params.projectId, teamId: params.teamId });
    if (currentProductionId !== body.id) {
        throw new Error(`Blank deployment ${body.id} is READY but is not current production (current: ${currentProductionId || "unknown"})`);
    }
    return body.id;
}

async function promoteDeployment(params: { accessToken: string; projectId: string; teamId?: string | null; deploymentId: string }): Promise<void> {
    const query = params.teamId ? `?teamId=${encodeURIComponent(params.teamId)}` : "";
    const res = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(params.projectId)}/promote/${encodeURIComponent(params.deploymentId)}${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${params.accessToken}` },
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`Blank deployment promotion failed (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
    }
}

async function waitForDeployment(params: { accessToken: string; teamId?: string | null; deploymentId: string }): Promise<void> {
    const query = params.teamId ? `?teamId=${encodeURIComponent(params.teamId)}` : "";
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        const res = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(params.deploymentId)}${query}`, {
            headers: { Authorization: `Bearer ${params.accessToken}` }, signal: AbortSignal.timeout(10_000),
        });
        const body = await res.json().catch(() => ({}));
        const state = String(body?.readyState || body?.state || "").toLowerCase();
        if (state === "ready") return;
        if (["error", "canceled", "cancelled"].includes(state)) {
            throw new Error(`Blank deployment ${params.deploymentId} ended in ${state}: ${body?.error?.message || JSON.stringify(body)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("Blank deployment did not become ready within 15 seconds");
}

async function rollbackProject(params: { accessToken: string; projectId: string; teamId?: string | null; deploymentId: string }): Promise<void> {
    const query = params.teamId ? `?teamId=${encodeURIComponent(params.teamId)}` : "";
    const res = await fetch(`https://api.vercel.com/v1/projects/${encodeURIComponent(params.projectId)}/rollback/${encodeURIComponent(params.deploymentId)}${query}`, {
        method: "POST", headers: { Authorization: `Bearer ${params.accessToken}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Project restore failed (${res.status})`);
    }
}

async function addVercelProjectDomain(params: { accessToken: string; projectId: string; teamId?: string | null; domain: string }): Promise<void> {
    const query = params.teamId ? `?teamId=${encodeURIComponent(params.teamId)}` : "";
    const res = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(params.projectId)}/domains${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: params.domain }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 400 && res.status !== 409) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Domain restore failed (${res.status})`);
    }
}

async function collectUserProjects(uid: string, userRef?: any): Promise<ProjectRecord[]> {
    const ref = userRef || await getUserRootRef(uid);
    const records = new Map<string, ProjectRecord>();

    const add = (data: any) => {
        const projectId = typeof data?.vercelProjectId === "string" ? data.vercelProjectId.trim() : "";
        if (!projectId) return;
        const existing = records.get(projectId);
        records.set(projectId, {
            projectId,
            teamId: data?.vercelTeamId || existing?.teamId || null,
            projectName: data?.vercelProjectName || existing?.projectName || null,
        });
    };

    const [apps, renders, deployments] = await Promise.all([
        ref.collection("kloner_apps").get(),
        ref.collection("kloner_renders").get(),
        ref.collection("deployments").get(),
    ]);

    apps.docs.forEach((snap: FirebaseFirestore.QueryDocumentSnapshot) => add(snap.data()));
    renders.docs.forEach((snap: FirebaseFirestore.QueryDocumentSnapshot) => add(snap.data()));
    deployments.docs.forEach((snap: FirebaseFirestore.QueryDocumentSnapshot) => add(snap.data()));
    return [...records.values()];
}

export async function suspendUserLiveSites(uid: string, reason: string): Promise<{ suspended: number; failed: number; projects?: ProjectRecord[] }> {
    if (!shouldEnforceLiveSiteAccess()) return { suspended: 0, failed: 0 };

    const userRef = await getUserRootRef(uid);
    const currentUserSnap = await userRef.get();
    const currentAccess = currentUserSnap.exists ? (currentUserSnap.data() as any)?.billingSiteAccess : null;
    const integrationRef = userRef.collection("integrations").doc("vercel");
    const integration = await loadVercelIntegration(integrationRef);
    if (!integration.accessToken) throw new Error("Vercel integration is not connected.");

    const projects = await collectUserProjects(uid, userRef);
    const previousProjects = new Map<string, ProjectRecord>(
        (Array.isArray(currentAccess?.projects) ? currentAccess.projects : []).map((project: ProjectRecord) => [project.projectId, project]),
    );
    const inspectedProjects: ProjectRecord[] = [];
    const projectResults: Array<Record<string, unknown>> = [];
    let failed = 0;

    for (const project of projects) {
        try {
            const current = await getVercelProject({
                accessToken: integration.accessToken,
                projectId: project.projectId,
                teamId: project.teamId,
            });
            if (!current) {
                failed += 1;
                projectResults.push({ projectId: project.projectId, status: "failed", error: "Vercel project could not be retrieved" });
                continue;
            }

            const currentProject = {
                ...project,
                domains: readProjectDomains(current),
                projectName: current.name || project.projectName || null,
            };
            inspectedProjects.push(currentProject);
            const previous = previousProjects.get(project.projectId);
            const latestProductionId = await getLatestProductionDeployment({ accessToken: integration.accessToken, projectId: project.projectId, teamId: project.teamId });
            if (previous?.suspensionDeploymentId && latestProductionId === previous.suspensionDeploymentId) {
                currentProject.originalDeploymentId = previous.originalDeploymentId || null;
                currentProject.suspensionDeploymentId = previous.suspensionDeploymentId;
                projectResults.push({ projectId: project.projectId, status: "succeeded", verified: true, originalDeploymentId: currentProject.originalDeploymentId, suspensionDeploymentId: currentProject.suspensionDeploymentId, domains: currentProject.domains || [] });
                continue;
            }
            const originalDeploymentId = previous?.originalDeploymentId || latestProductionId;
            if (!originalDeploymentId) throw new Error("No current production deployment found");
            currentProject.originalDeploymentId = originalDeploymentId;
            currentProject.suspensionDeploymentId = await deployBlankSite({ accessToken: integration.accessToken, projectId: project.projectId, teamId: project.teamId, projectName: currentProject.projectName });
            projectResults.push({ projectId: currentProject.projectId, status: "succeeded", originalDeploymentId: currentProject.originalDeploymentId, suspensionDeploymentId: currentProject.suspensionDeploymentId, domains: currentProject.domains || [] });
        } catch (error) {
            failed += 1;
            projectResults.push({ projectId: project.projectId, status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
    }
    const suspendedProjects = inspectedProjects.filter((project) => project.suspensionDeploymentId);

    await userRef.set(
        {
            billingSiteAccess: {
                state: "suspended",
                method: failed === 0 ? "blank_deployment" : "blank_deployment_partial",
                reason,
                suspendedAt: new Date(),
                projects: suspendedProjects,
            },
        },
        { merge: true },
    );

    const domainList = inspectedProjects.flatMap((project) => project.domains || []);
    const projectList = inspectedProjects.map((project) => project.projectId);
    await captureAuditEvent({
        source: "vercel",
        severity: "info",
        route: "/api/billing/subscription-site-access",
        method: "PATCH",
        action: "billing.liveSites.suspension_completed",
        userId: uid,
        service: "vercel-project-access",
        message: `Live-site pause completed for canceled user ${uid}: ${suspendedProjects.length} succeeded, ${failed} failed out of ${projects.length}. Results: ${projectResults.map((project) => `${project.projectId}=${project.status}${project.error ? ` (${project.error})` : ""}`).join("; ") || "none"}`,
        extra: {
            reason,
            projectIds: projectList,
            domains: domainList,
            suspendedCount: suspendedProjects.length,
            failedCount: failed,
            projects: projectResults,
        },
    });

    return { suspended: suspendedProjects.length, failed, projects: suspendedProjects };
}

export async function restoreUserLiveSites(uid: string): Promise<{ restored: number; failed: number }> {
    if (!shouldEnforceLiveSiteAccess()) return { restored: 0, failed: 0 };

    const userRef = await getUserRootRef(uid);
    const snap = await userRef.get();
    const state = snap.exists ? (snap.data() as any)?.billingSiteAccess : null;
    const projects = Array.isArray(state?.projects) ? (state.projects as ProjectRecord[]) : [];
    if (state?.state !== "suspended") return { restored: 0, failed: 0 };

    const integration = await loadVercelIntegration(userRef.collection("integrations").doc("vercel"));
    if (!integration.accessToken) throw new Error("Vercel integration is not connected.");

    let restored = 0;
    let failed = 0;
    const projectResults: Array<Record<string, unknown>> = [];
    for (const project of projects) {
        try {
            if (project.originalDeploymentId) {
                const currentDeploymentId = await getLatestProductionDeployment({
                    accessToken: integration.accessToken,
                    projectId: project.projectId,
                    teamId: project.teamId,
                });
                if (currentDeploymentId !== project.originalDeploymentId) {
                    await rollbackProject({ accessToken: integration.accessToken, projectId: project.projectId, teamId: project.teamId, deploymentId: project.originalDeploymentId });
                }
            } else if (project.detachedDomains?.length || project.domains?.length) {
                // Backward compatibility for sites suspended by the former
                // custom-domain-detach implementation.
                for (const domain of (project.detachedDomains || project.domains || [])) {
                    if (!domain.toLowerCase().endsWith(".vercel.app")) {
                        await addVercelProjectDomain({ accessToken: integration.accessToken, projectId: project.projectId, teamId: project.teamId, domain });
                    }
                }
            } else {
                throw new Error("Original deployment is not recorded");
            }
            restored += 1;
            projectResults.push({ projectId: project.projectId, status: "succeeded", originalDeploymentId: project.originalDeploymentId, suspensionDeploymentId: project.suspensionDeploymentId || null });
        } catch (error) {
            failed += 1;
            projectResults.push({ projectId: project.projectId, status: "failed", originalDeploymentId: project.originalDeploymentId || null, error: error instanceof Error ? error.message : String(error) });
        }
    }

    if (failed === 0) {
        await userRef.set(
            {
                billingSiteAccess: {
                    state: "active",
                    restoredAt: new Date(),
                },
            },
            { merge: true },
        );
    }
    await captureAuditEvent({
        source: "vercel",
        severity: failed > 0 ? "critical" : "info",
        alwaysNotifySlack: true,
        route: "/api/private/process-billing-site-access",
        method: "POST",
        action: "billing.liveSites.restore_completed",
        userId: uid,
        service: "vercel-project-access",
        message: `Live-site restore completed for resumed user ${uid}: ${restored} succeeded, ${failed} failed out of ${projects.length}. Results: ${projectResults.map((project) => `${project.projectId}=${project.status}${project.error ? ` (${project.error})` : ""}`).join("; ") || "none"}`,
        extra: { projectCount: projects.length, restoredCount: restored, failedCount: failed, projects: projectResults },
    });
    return { restored, failed };
}

/** Enqueue work so Stripe/webhook requests never wait on Vercel deployment APIs. */
export async function enqueueSiteAccessJob(uid: string, operation: SiteAccessJobOperation, reason?: string): Promise<void> {
    const ref = getDb().collection("billing_site_access_jobs").doc(uid);
    await ref.set({
        uid,
        operation,
        reason: reason || null,
        status: "queued",
        attempts: 0,
        queuedAt: new Date(),
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
    }, { merge: true });
}

export async function reportSiteAccessChangeRequested(uid: string, operation: SiteAccessJobOperation): Promise<void> {
    const projects = await collectUserProjects(uid);
    await captureAuditEvent({
        source: "vercel",
        severity: "info",
        alwaysNotifySlack: true,
        route: "/api/billing/cancel-subscription",
        method: "POST",
        action: operation === "suspend" ? "billing.liveSites.pause_queued" : "billing.liveSites.resume_requested",
        userId: uid,
        service: "billing-site-access-worker",
        message: operation === "suspend"
            ? `Subscription cancellation received for ${uid}; live-site pause processing queued. Kloner-linked Vercel projects: ${projects.length}.`
            : `Subscription resume requested for ${uid}. Live-site restore processing queued. Kloner-linked Vercel projects: ${projects.length}.`,
        extra: { operation, projectCount: projects.length, projectIds: projects.map((project) => project.projectId) },
    });
}

export function reportSiteAccessCancellationRequested(uid: string): Promise<void> {
    return reportSiteAccessChangeRequested(uid, "suspend");
}

function appOrigin(): string {
    return (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://kloner.app").replace(/\/$/, "");
}

export async function sendSiteAccessSuspendedEmail(params: {
    uid: string;
    email: string;
    name?: string | null;
    reason: string;
}): Promise<void> {
    const userRef = await getUserRootRef(params.uid);
    const snap = await userRef.get();
    const data = snap.exists ? (snap.data() as any) : {};
    if (data?.billingNotifications?.siteAccessSuspendedReason === params.reason) return;

    const renewalUrl = `${appOrigin()}/price?billing=renewal`;
    const name = (params.name || "there").trim() || "there";
    const paymentIssue = params.reason === "payment_failed";
    const subject = paymentIssue ? "Action required: your Kloner sites are offline" : "Your Kloner sites are offline after cancellation";
    const text = `Hey ${name},\n\n${paymentIssue ? "We couldn't process your Kloner subscription payment." : "Your Kloner subscription was cancelled."} Your live Kloner sites have been taken offline and will remain unavailable until you renew.\n\nRenew your subscription:\n${renewalUrl}\n\n— The Kloner team`;
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.6"><p>Hey ${name},</p><p>${paymentIssue ? "We couldn't process your Kloner subscription payment." : "Your Kloner subscription was cancelled."} Your live Kloner sites have been taken offline and will remain unavailable until you renew.</p><p><a href="${renewalUrl}" style="display:inline-block;padding:12px 18px;background:#ff8d21;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Renew your subscription</a></p><p>— The Kloner team</p></body></html>`;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
        from: process.env.WELCOME_EMAIL_FROM || "Kloner Team <hello@kloner.app>",
        to: params.email,
        subject,
        text,
        html,
    });
    if ((result as any)?.error) throw new Error((result as any).error.message || "Site access email failed");

    await userRef.set(
        { billingNotifications: { siteAccessSuspendedReason: params.reason, siteAccessSuspendedAt: new Date() } },
        { merge: true },
    );
}
