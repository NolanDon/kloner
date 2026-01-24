type VercelEnvTarget = "production" | "preview" | "development";

type VercelEnv = {
    id: string;
    key: string;
    value?: string;
    target?: VercelEnvTarget[];
    type?: "encrypted" | "plain";
};

async function vercelFetch(url: string, init: RequestInit & { accessToken: string }): Promise<Response> {
    const { accessToken, ...rest } = init;
    return fetch(url, {
        ...rest,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(rest.headers || {}),
        },
        signal: AbortSignal.timeout(30_000),
    });
}

export async function upsertVercelProjectEnvVar(params: {
    accessToken: string;
    teamId?: string;
    projectId: string;
    key: string;
    value: string;
    target?: VercelEnvTarget[];
    type?: "encrypted" | "plain";
}): Promise<void> {
    const target = params.target ?? ["production", "preview", "development"];
    const type = params.type ?? "encrypted";

    const qs = params.teamId ? `?teamId=${encodeURIComponent(params.teamId)}` : "";
    const listUrl = `https://api.vercel.com/v9/projects/${encodeURIComponent(params.projectId)}/env${qs}`;

    const listRes = await vercelFetch(listUrl, { method: "GET", accessToken: params.accessToken });
    const listJson = await listRes.json().catch(() => ({} as any));

    const envs: VercelEnv[] = Array.isArray((listJson as any)?.envs) ? (listJson as any).envs : [];
    const existing = envs.find((e) => e.key === params.key);

    if (!existing) {
        const createUrl = `https://api.vercel.com/v9/projects/${encodeURIComponent(params.projectId)}/env${qs}`;
        const createRes = await vercelFetch(createUrl, {
            method: "POST",
            accessToken: params.accessToken,
            body: JSON.stringify({
                key: params.key,
                value: params.value,
                type,
                target,
            }),
        });

        if (!createRes.ok) {
            const err = await createRes.text().catch(() => "");
            throw new Error(`Failed to create Vercel env ${params.key}: ${createRes.status} ${err}`);
        }

        return;
    }

    // Update existing
    const patchUrl = `https://api.vercel.com/v9/projects/${encodeURIComponent(params.projectId)}/env/${encodeURIComponent(existing.id)}${qs}`;
    const patchRes = await vercelFetch(patchUrl, {
        method: "PATCH",
        accessToken: params.accessToken,
        body: JSON.stringify({
            key: params.key,
            value: params.value,
            type,
            target,
        }),
    });

    if (!patchRes.ok) {
        const err = await patchRes.text().catch(() => "");
        throw new Error(`Failed to update Vercel env ${params.key}: ${patchRes.status} ${err}`);
    }
}
