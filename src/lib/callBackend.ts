// src/lib/callBackend.ts
import crypto from "node:crypto";

type Reqish =
    | { headers?: any; get?: (name: string) => string | undefined } // Express req
    | { headers?: Headers } // NextRequest
    | null
    | undefined;

type CallOpts = {
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
    body?: any;
    query?: Record<string, string | number | boolean | null | undefined>;
    headers?: Record<string, string>;
    timeoutMs?: number;
    idempotencyKey?: string;
    /** If provided, signs x-user-ctx/x-user-ctx-sig with INTERNAL_API_KEY */
    userCtx?: { uid?: string; email?: string; tier?: string | null | undefined };
    /**
     * If true, convert AbortError (timeout) into a 202 Accepted pseudo-response.
     * Useful for "kick a job and return fast" routes.
     */
    acceptOnTimeout?: boolean;
    /**
     * When true, DO NOT prepend BACKEND_PREFIX. Use this for root-mounted routes like '/generate-screenshots'.
     */
    noPrefix?: boolean;
};

// src/lib/callBackend.ts (unchanged imports/types above)

const BACKEND_ORIGIN =
    process.env.BACKEND_ORIGIN ||
    process.env.BACKEND_URL ||
    process.env.PUBLIC_ORIGIN ||
    `http://127.0.0.1:${process.env.PORT || 8080}`;

const BACKEND_PREFIX = (process.env.BACKEND_PREFIX ?? '/api/v1').replace(/^\/+|\/+$/g, '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

function buildUrl(path: string, qp?: Record<string, any>): string {
    const absolute = /^https?:\/\//i.test(path);
    const p = path.startsWith('/') ? path : `/${path}`;
    const base = BACKEND_ORIGIN.replace(/\/+$/, '');
    const prefix = p.startsWith('/internal/') ? '' : (BACKEND_PREFIX ? `/${BACKEND_PREFIX}` : '');
    const urlStr = absolute ? path : `${base}${prefix}${p}`;
    const url = new URL(urlStr);
    Object.entries(qp || {}).forEach(([k, v]) => {
        if (v != null) url.searchParams.set(k, String(v));
    });
    return url.toString();
}

function signUserCtx(userCtx: NonNullable<CallOpts['userCtx']>) {
    const payload = Buffer.from(JSON.stringify(userCtx)).toString('base64');
    const sig = crypto.createHmac('sha256', INTERNAL_API_KEY).update(payload).digest('hex');
    return { payload, sig };
}

function readHeader(req: Reqish, name: string): string {
    if (!req) return '';
    // Express-style
    if (typeof (req as any).get === 'function') return ((req as any).get(name) as string) || '';
    // NextRequest (Headers)
    const h = (req as any).headers;
    if (h?.get) return h.get(name) || '';
    if (h && typeof h === 'object') {
        const n = name.toLowerCase();
        return (h[n] || h[name]) ?? '';
    }
    return '';
}

export async function callBackend(req: Reqish, opts: CallOpts) {
    if (!INTERNAL_API_KEY) throw new Error('INTERNAL_API_KEY not set');

    const method = (opts.method || 'POST').toUpperCase() as NonNullable<CallOpts['method']>;
    const url = buildUrl(opts.path, opts.query);

    const inboundId = readHeader(req, 'x-request-id');
    const reqId = inboundId || crypto.randomBytes(8).toString('hex');

    const signed = opts.userCtx ? signUserCtx(opts.userCtx) : null;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

    let upstream: Response;
    try {
        upstream = await fetch(url, {
            method,
            headers: {
                ...(opts.headers || {}),
                'content-type': 'application/json',
                'cache-control': 'no-store',
                'x-request-id': reqId,
                'x-internal-key': INTERNAL_API_KEY,
                ...(signed
                    ? { 'x-user-ctx': signed.payload, 'x-user-ctx-sig': signed.sig }
                    : {}),
                ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
            },
            body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : JSON.stringify(opts.body ?? {}),
            signal: controller.signal,
        });
    } catch (err: any) {
        clearTimeout(timeoutHandle);
        const aborted = err?.name === 'AbortError';
        if (aborted && opts.acceptOnTimeout) {
            const json = { started: true, code: 'TIMEOUT_ACCEPTED' };
            const fake = new Response(JSON.stringify(json), { status: 202 });
            return { upstream: fake as any, status: 202, json, raw: JSON.stringify(json), reqId, url };
        }
        const status = aborted ? 504 : 502;
        const json = { error: aborted ? 'Backend timeout' : 'Backend fetch failed' };
        return { upstream: new Response(JSON.stringify(json), { status }) as any, status, json, raw: JSON.stringify(json), reqId, url };
    }

    clearTimeout(timeoutHandle);

    const raw = await upstream.text();
    let json: any;
    try { json = JSON.parse(raw); } catch { json = { ok: upstream.ok, data: raw }; }

    return { upstream, status: upstream.status, json, raw, reqId, url };
}

