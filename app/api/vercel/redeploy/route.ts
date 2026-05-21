// app/api/vercel/redeploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { loadVercelIntegration } from "@/app/api/_lib/vercel-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env missing");

    let parsed: admin.ServiceAccount;
    try {
        if (raw.trim().startsWith("{")) {
            parsed = JSON.parse(raw);
        } else {
            parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        }
    } catch (e) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT", e);
        throw e;
    }

    admin.initializeApp({
        credential: admin.credential.cert(parsed),
    });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req, uid }) => {
            try {
                const { vercelDeploymentId } = (await req.json()) as {
                    vercelDeploymentId?: string;
                    vercelProjectId?: string | null;
                    vercelProjectName?: string | null;
                };

                if (!vercelDeploymentId) {
                    return NextResponse.json(
                        { ok: false, error: "Missing vercelDeploymentId" },
                        { status: 400 }
                    );
                }

                const db = getAdminDb();
                const integRef = db
                    .collection("kloner_users")
                    .doc(uid)
                    .collection("integrations")
                    .doc("vercel");

                const integ = await loadVercelIntegration(integRef as any);
                if (!integ.exists) {
                    return NextResponse.json(
                        { ok: false, error: "Vercel not connected for this user" },
                        { status: 400 }
                    );
                }

                if (!integ.accessToken) {
                    return NextResponse.json(
                        {
                            ok: false,
                            error: "Missing Vercel accessToken for this user",
                        },
                        { status: 400 }
                    );
                }

                const vercelTeamId = typeof integ.data?.vercelTeamId === "string" ? integ.data.vercelTeamId : null;

                const params = new URLSearchParams();
                if (vercelTeamId) {
                    params.set("teamId", vercelTeamId);
                }

                const url = `https://api.vercel.com/v13/deployments/${vercelDeploymentId}/rebuild${params.toString() ? `?${params.toString()}` : ""
                    }`;

                const vercelRes = await fetch(url, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${integ.accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                });

                const body = await vercelRes.json().catch(() => ({}));

                if (!vercelRes.ok) {
                    return NextResponse.json(
                        {
                            ok: false,
                            error:
                                (body?.error &&
                                    (body.error.message || body.error.code)) ||
                                `Vercel error ${vercelRes.status}`,
                            vercelStatus: vercelRes.status,
                            vercelBody: body,
                        },
                        { status: 502 }
                    );
                }

                return NextResponse.json(
                    {
                        ok: true,
                        deploymentId: body?.id,
                        url: body?.url ? `https://${body.url}` : null,
                        projectId: body?.projectId ?? null,
                        projectName: body?.name ?? null,
                    },
                    { status: 200 }
                );
            } catch (err: any) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: err?.message || "Internal redeploy error",
                    },
                    { status: 500 }
                );
            }
        },
        { methods: ["POST"], csrf: true }
    );
}
