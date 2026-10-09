import { createHash } from "node:crypto";

export async function createVercelProject({ url, token, name, appId, settings, fetcher = fetch }: {
    url: string; token: string; name: string; appId: string;
    settings: Record<string, unknown>; fetcher?: typeof fetch;
}) {
    const suffix = createHash("sha256").update(appId).digest("hex").slice(0, 12);
    for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = attempt === 0 ? name.slice(0, 100) : `${name.slice(0, 82)}-${suffix}${attempt > 1 ? `-${attempt}` : ""}`;
        const response = await fetcher(url, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ...settings, name: candidate }), signal: AbortSignal.timeout(30_000),
        });
        const json = await response.json().catch(() => ({}));
        const collision = [400, 409].includes(response.status) &&
            (json?.error?.code === "name_already_exists" || /^Project "[^"]+" already exists\.?$/i.test(json?.error?.message || ""));
        if (response.ok || !collision || attempt === 2) return { response, json, name: candidate };
    }
    throw new Error("Project creation attempts exhausted");
}
