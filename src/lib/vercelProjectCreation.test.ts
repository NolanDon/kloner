import { createVercelProject } from "./vercelProjectCreation";

test("name collisions create a new app-specific project in the same team without touching the existing project", async () => {
    const bodies: any[] = [];
    const fetcher = jest.fn(async (url, options) => {
        expect(url).toBe("https://api.vercel.com/v10/projects?teamId=team-owner");
        expect(options?.method).toBe("POST");
        bodies.push(JSON.parse(String(options?.body)));
        return bodies.length === 1 ? Response.json({ error: { message: 'Project "site" already exists.' } }, { status: 400 }) : Response.json({ id: "new-project", name: bodies.at(-1).name });
    }) as typeof fetch;
    const result = await createVercelProject({ url: "https://api.vercel.com/v10/projects?teamId=team-owner", token: "test-token", name: "site", appId: "app-one", settings: { framework: "nextjs" }, fetcher });
    expect(result.json.id).toBe("new-project");
    expect(bodies[1].name).toMatch(/^site-[a-f0-9]{12}$/);
    expect(bodies[1].framework).toBe("nextjs");
});

test("permission and unrelated failures are not retried; name retries are bounded", async () => {
    for (const status of [401, 403, 500, 400]) {
        const fetcher = jest.fn(async () => Response.json({ error: { code: "forbidden" } }, { status })) as typeof fetch;
        const result = await createVercelProject({ url: "https://api.vercel.com/v10/projects", token: "test-token", name: "site", appId: "app", settings: {}, fetcher });
        expect(result.response.status).toBe(status);
        expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const fetcher = jest.fn(async () => Response.json({ error: { code: "name_already_exists" } }, { status: 409 })) as typeof fetch;
    await createVercelProject({ url: "https://api.vercel.com/v10/projects", token: "test-token", name: "site", appId: "app", settings: {}, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(3);
});
