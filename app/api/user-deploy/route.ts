// src/app/api/user-deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, verifySession } from "../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    // Require authenticated user via Firebase session cookie
    const user = await verifySession(req);
    const {
        html,
        projectName,
        renderId,
        vercelProjectId: bodyProjectId,
        vercelProjectName: bodyProjectName,
    } = await req.json();

    if (!html || typeof html !== "string") {
        return NextResponse.json(
            { ok: false, error: "Missing html" },
            { status: 400 }
        );
    }

    const db = getAdminDb();
    const uid = user.uid;

    let renderDoc: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;

    // Start from whatever project info we already know (Deployments page)
    let vercelProjectId: string | null = bodyProjectId ?? null;
    let vercelProjectName: string | null = bodyProjectName ?? null;

    // Optional: reuse project info from the render doc, overrides body if present
    if (renderId) {
        const ref = db.doc(`kloner_users/${uid}/kloner_renders/${renderId}`);
        renderDoc = await ref.get();
        if (!renderDoc.exists) {
            return NextResponse.json(
                { ok: false, error: "Render not found" },
                { status: 404 }
            );
        }
        const data = renderDoc.data() || {};
        vercelProjectId = (data.vercelProjectId as string) || vercelProjectId;
        vercelProjectName = (data.vercelProjectName as string) || vercelProjectName;
    }

    // Load Vercel integration credentials
    const integrationRef = db.doc(`kloner_users/${uid}/integrations/vercel`);
    const integrationSnap = await integrationRef.get();
    if (!integrationSnap.exists) {
        return NextResponse.json(
            { ok: false, error: "Vercel is not connected for this account." },
            { status: 400 }
        );
    }

    const { accessToken, vercelTeamId } = integrationSnap.data() as {
        accessToken: string;
        vercelTeamId?: string;
    };

    // Derive project base name
    const nameFromRender =
        vercelProjectName ||
        projectName ||
        (renderDoc?.data()?.nameHint as string | undefined) ||
        "kloner-site";

    const slugBase =
        nameFromRender
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 20) || "kloner-site";

    const projectSlug = slugBase;

    // Use a valid Vercel framework enum
    const FRAMEWORK = "express";

    // ───────────────────────── create project if needed ─────────────────────────
    if (!vercelProjectId) {
        const projectUrl = vercelTeamId
            ? `https://api.vercel.com/v10/projects?teamId=${encodeURIComponent(
                vercelTeamId
            )}`
            : "https://api.vercel.com/v10/projects";

        const projectRes = await fetch(projectUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: projectSlug,
                framework: FRAMEWORK,
                buildCommand: null,
                devCommand: null,
                outputDirectory: null,
            }),
        });

        const projectJson = await projectRes.json().catch(() => ({}));

        if (!projectRes.ok) {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        projectJson?.error?.message ||
                        "Failed to create Vercel project",
                },
                { status: 400 }
            );
        }

        vercelProjectId = projectJson.id as string;
        vercelProjectName = projectJson.name as string;

        if (renderDoc) {
            await renderDoc.ref.set(
                {
                    vercelProjectId,
                    vercelProjectName,
                },
                { merge: true }
            );
        }
    }

    // ─────────────────────── create deployment to project ───────────────────────

    const files = [
        {
            file: "index.html",
            data: Buffer.from(html, "utf8").toString("base64"),
            encoding: "base64" as const,
        },
    ];

    const deployParams = new URLSearchParams();
    if (vercelTeamId) {
        deployParams.set("teamId", vercelTeamId);
    }
    // Avoid auto-detection confirmation
    deployParams.set("skipAutoDetectionConfirmation", "1");

    const deployUrl = `https://api.vercel.com/v13/deployments?${deployParams.toString()}`;

    const deployRes = await fetch(deployUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: vercelProjectName,
            project: vercelProjectId,
            files,
            projectSettings: {
                framework: FRAMEWORK,
                buildCommand: null,
                devCommand: null,
                outputDirectory: null,
            },
        }),
    });

    const deployJson = await deployRes.json().catch(() => ({}));

    if (!deployRes.ok) {
        return NextResponse.json(
            {
                ok: false,
                error:
                    deployJson?.error?.message ||
                    "Deployment failed",
            },
            { status: 400 }
        );
    }

    const vercelDeploymentId = deployJson.id as string | undefined;
    const vercelStateRaw = (deployJson.state as string | undefined) || "building";
    const vercelState = vercelStateRaw.toLowerCase();
    const url = deployJson.url ? `https://${deployJson.url}` : null;

    // Update render doc with last deploy info
    if (renderDoc && url) {
        await renderDoc.ref.set(
            {
                lastDeployUrl: url,
                lastExportedAt: new Date(),
            },
            { merge: true }
        );
    }

    // ─────────────────────── record deployment document ────────────────────────
    if (vercelDeploymentId) {
        const now = Date.now();

        const deploymentRef = db
            .collection("kloner_users")
            .doc(uid)
            .collection("deployments")
            .doc(vercelDeploymentId);

        await deploymentRef.set(
            {
                vercelDeploymentId,
                vercelProjectId: vercelProjectId ?? null,
                vercelProjectName: vercelProjectName ?? null,
                vercelUrl: url,
                vercelState,
                vercelTeamId: vercelTeamId ?? null,
                vercelUserId: null,
                configurationId: null,
                lastEventType: "created",
                lastEventId: vercelDeploymentId,
                lastEventAt: now,
                createdAt: now,
                updatedAt: now,
            },
            { merge: true }
        );
    }

    return NextResponse.json({
        ok: true,
        url,
        projectId: vercelProjectId,
        projectName: vercelProjectName,
    });
}
