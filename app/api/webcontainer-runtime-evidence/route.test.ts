export {};
const update = jest.fn(), scope = jest.fn(), guard = jest.fn(), paths: string[] = [];
let exists = true;
const database: any = {
  collection: (path: string) => { paths.push(path); return database; },
  doc: (path: string) => { paths.push(path); return database; },
  runTransaction: async (fn: any) => fn({ get: async () => ({ exists, data: () => ({}) }), update }),
};
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, options?: any) => ({ status: options?.status || 200, body }) } }));
jest.mock('../_lib/route-guard', () => ({ requireSessionAndMaybeCsrf: async (req: any, handler: any, opts: unknown) => { guard(opts); return handler({ req, uid: 'owner' }); } }));
jest.mock('../_lib/appBuilderScope', () => ({ assertAppBuilderScope: (...args: unknown[]) => scope(...args) }));
jest.mock('../_lib/auth', () => ({ getAdminDb: () => database }));

describe('preview browser evidence storage', () => {
  const report = () => ({ version: 1, navigationId: 'navigation-1', startedAt: Date.now() - 4000, capturedAt: Date.now(),
    url: 'https://preview.kloner.app/', confirmedBlank: true, page: { blank: true, visibleElementCount: 0 } });
  beforeEach(() => { jest.clearAllMocks(); paths.length = 0; exists = true; });
  const request = (overrides = {}) => ({ text: async () => JSON.stringify({ appId: 'app-1', code: 'preview-1', runtime: report(), ...overrides }) }) as any;
  it('requires session, CSRF, and app scope and writes only an existing owner-scoped preview', async () => {
    const { POST } = await import('./route');
    const req = request();
    expect((await POST(req)).status).toBe(200);
    expect(guard).toHaveBeenCalledWith({ csrf: true, methods: ['POST'] });
    expect(scope).toHaveBeenCalledWith(req, 'owner', 'app-1');
    expect(paths).toEqual(['kloner_users', 'owner', 'kloner_apps', 'app-1', 'previews', 'preview-1']);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('does not create preview documents or accept stale, arbitrary-origin, or malformed evidence', async () => {
    const { POST } = await import('./route');
    exists = false;
    expect((await POST(request())).status).toBe(404);
    for (const runtime of [{ ...report(), capturedAt: Date.now() - 180_000 }, { ...report(), url: 'https://evil.example/' }, {}]) {
      expect((await POST(request({ runtime }))).status).toBe(400);
    }
    expect((await POST(request({ appId: '../other' }))).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
