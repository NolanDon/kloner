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
    expect(result.after).toEqual({});
    expect(result.omittedPaths).toEqual(['public/index.html', 'new.js', '.env.local', 'image.png', 'large.html']);
    expect(result.source).toBe('workspace_autonomy_v3');
    expect(JSON.stringify(result)).not.toContain('SECRET');
});

test('old snapshots use current content only when it matches the recorded after hash', async () => {
    const { createHash } = await import('node:crypto');
    const after = '<h1>Greenleaf</h1>';
    const doc = { id: 'rp', data: () => ({ afterHashes: { 'index.html': createHash('sha256').update(after).digest('hex') } }), ref: { collection: () => ({ get: async () => ({ docs: [{ data: () => ({ path: 'index.html', exists: true, content: '<h1>Moqup</h1>' }) }] }) }) } };
    expect((await workspaceRestoreDetails(doc, { loadCurrentText: async () => after })).after).toEqual({ 'index.html': after });
    expect((await workspaceRestoreDetails(doc, { loadCurrentText: async () => 'a later edit' })).after).toEqual({});
});
test('new snapshots return exact historical after bytes, including explicit deletion', async () => {
    const doc = { id: 'rp', data: () => ({}), ref: { collection: () => ({ get: async () => ({ docs: [
        { data: () => ({ path: 'index.html', exists: true, content: '<h1>Moqup</h1>', afterExists: true, afterContent: '<h1>Greenleaf</h1>' }) },
        { data: () => ({ path: 'old.js', exists: true, content: 'old', afterExists: false }) },
    ] }) }) } };
    expect((await workspaceRestoreDetails(doc)).after).toEqual({ 'index.html': '<h1>Greenleaf</h1>', 'old.js': null });
});
