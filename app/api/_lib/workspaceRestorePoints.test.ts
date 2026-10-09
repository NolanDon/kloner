import { workspaceRestoreDetails } from "./workspaceRestorePoints";
test("workspace restore details read per-file snapshots without exposing env, binary, or unresolved storage contents", async () => {
    const data = [
        { path: 'public/index.html', exists: true, content: '<h1>before</h1>' },
        { path: 'new.js', exists: false },
        { path: '.env.local', exists: true, content: 'SECRET' },
        { path: 'image.png', exists: true, encoding: 'base64', content: 'binary' },
        { path: 'large.html', exists: true, storagePath: 'private/object' },
    ];
    const result = await workspaceRestoreDetails({ id: 'restore', data: () => ({ touchedPaths: data.map(x => x.path), requestId: 'req' }), ref: { collection: (name: string) => {
        expect(name).toBe('files');
        return { get: async () => ({ docs: data.map(x => ({ data: () => x })) }) };
    } } });
    expect(result.before).toEqual({ 'public/index.html': '<h1>before</h1>', 'new.js': null });
    expect(result.omittedPaths).toEqual(['.env.local', 'image.png', 'large.html']);
    expect(result.source).toBe('workspace_autonomy_v3');
    expect(JSON.stringify(result)).not.toContain('SECRET');
});
