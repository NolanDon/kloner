import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "@/app/api/_lib/auth";
import { getFirestore } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
    try {
        // verifySession expects a NextRequest, not a string
        const authInfo = await verifySession(req);
        if (!authInfo || !authInfo.uid) {
            return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

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

        const db = getFirestore();
        const integRef = db
            .collection("kloner_users")
            .doc(authInfo.uid)
            .collection("integrations")
            .doc("vercel");

        const integSnap = await integRef.get();
        if (!integSnap.exists) {
            return NextResponse.json(
                { ok: false, error: "Vercel not connected for this user" },
                { status: 400 }
            );
        }

        const integ = integSnap.data() as {
            accessToken?: string;
            vercelTeamId?: string | null;
            vercelUserId?: string | null;
        };

        if (!integ.accessToken) {
            return NextResponse.json(
                { ok: false, error: "Missing Vercel accessToken for this user" },
                { status: 400 }
            );
        }

        const params = new URLSearchParams();
        if (integ.vercelTeamId) params.set("teamId", integ.vercelTeamId);

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
                        (body?.error && (body.error.message || body.error.code)) ||
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
            { ok: false, error: err?.message || "Internal redeploy error" },
            { status: 500 }
        );
    }
}
