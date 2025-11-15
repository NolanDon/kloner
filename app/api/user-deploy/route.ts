// src/app/api/user-deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, verifySession } from "../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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

    let renderDoc:
        | FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>
        | null = null;

    let vercelProjectId: string | null = bodyProjectId ?? null;
    let vercelProjectName: string | null = bodyProjectName ?? null;

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

    // We want a pure static site
    const FRAMEWORK: null = null;

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
                framework: FRAMEWORK, // static / no framework
                buildCommand: null,
                devCommand: null,
                outputDirectory: null,
            }),
        });

        const projectJson = await projectRes.json().catch(() => ({} as any));

        if (!projectRes.ok) {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        (projectJson as any)?.error?.message ||
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
    } else {
        // Project already exists (possibly created earlier as "express")
        // Force it to static / no framework so the builder stops expecting Node/Express files.
        const patchUrl = vercelTeamId
            ? `https://api.vercel.com/v10/projects/${vercelProjectId}?teamId=${encodeURIComponent(
                vercelTeamId
            )}`
            : `https://api.vercel.com/v10/projects/${vercelProjectId}`;

        const patchRes = await fetch(patchUrl, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                framework: FRAMEWORK,
                buildCommand: null,
                devCommand: null,
                outputDirectory: null,
                rootDirectory: null,
            }),
        });

        // Ignore patch failure here, deployment will still attempt; but this
        // stops old "express" configs from persisting.
        await patchRes.text().catch(() => undefined);
    }

    // ─────────────────────── create deployment to project ───────────────────────

    const indexFile = {
        file: "index.html",
        data: Buffer.from(html, "utf8").toString("base64"),
        encoding: "base64" as const,
    };

    const vercelJsonFile = {
        file: "vercel.json",
        data: Buffer.from(
            JSON.stringify({
                rewrites: [{ source: "/(.*)", destination: "/index.html" }],
            }),
            "utf8"
        ).toString("base64"),
        encoding: "base64" as const,
    };

    const files = [indexFile, vercelJsonFile];

    const deployParams = new URLSearchParams();
    if (vercelTeamId) {
        deployParams.set("teamId", vercelTeamId);
    }
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
            // Keep this minimal for a static project
            projectSettings: {
                framework: FRAMEWORK,
                buildCommand: null,
                devCommand: null,
                outputDirectory: null,
            },
        }),
    });

    const deployJson = await deployRes.json().catch(() => ({} as any));

    if (!deployRes.ok) {
        return NextResponse.json(
            {
                ok: false,
                error:
                    (deployJson as any)?.error?.message ||
                    "Deployment failed",
            },
            { status: 400 }
        );
    }

    const vercelDeploymentId = deployJson.id as string | undefined;
    const vercelStateRaw = (deployJson.state as string | undefined) || "building";
    const vercelState = vercelStateRaw.toLowerCase();
    const url = deployJson.url ? `https://${deployJson.url}` : null;

    if (renderDoc && url) {
        await renderDoc.ref.set(
            {
                lastDeployUrl: url,
                lastExportedAt: new Date(),
            },
            { merge: true }
        );
    }

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
