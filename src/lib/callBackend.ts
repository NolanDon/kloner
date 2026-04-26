// src/lib/callBackend.ts
import crypto from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";
import dns from "node:dns";

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
     * When true, DO NOT prepend BACKEND_PREFIX. Use this for root-mounted routes.
     */
    noPrefix?: boolean;
};

const BACKEND_ORIGIN =
    process.env.BACKEND_ORIGIN ||
    process.env.BACKEND_URL ||
    process.env.PUBLIC_ORIGIN ||
    `http://127.0.0.1:${process.env.PORT || 8080}`;

const BACKEND_PREFIX = (process.env.BACKEND_PREFIX ?? "/api/v1").replace(
    /^\/+|\/+$/g,
    ""
);
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

let ipv4Dispatcher: Agent | null = null;

function isFlyHost(urlStr: string): boolean {
    try {
        const host = new URL(urlStr).hostname.toLowerCase();
        return host.endsWith(".fly.dev");
    } catch {
        return false;
    }
}

function getIpv4Dispatcher(): Agent {
    if (!ipv4Dispatcher) {
        const lookup: any = (hostname: string, opts: any, cb: any) => {
            return dns.lookup(hostname, { ...(opts || {}), family: 4 }, cb);
        };
        ipv4Dispatcher = new Agent({ connect: { lookup } as any });
    }
    return ipv4Dispatcher;
}

function shouldForceIpv4Always(): boolean {
    const forced = String(process.env.FORCE_IPV4_BACKEND || "").trim();
    if (forced === "1" || forced.toLowerCase() === "true") return true;
    return false;
}

function shouldRetryWithIpv4(err: any, urlStr: string): boolean {
    if (!isFlyHost(urlStr)) return false;
    const aggregateErrors: any[] = Array.isArray(err?.cause?.errors)
        ? err.cause.errors
        : Array.isArray(err?.errors)
          ? err.errors
          : [];

    const codes = new Set<string>();
    const pushCode = (c: any) => {
        const s = String(c || "").trim();
        if (s) codes.add(s);
    };

    pushCode(err?.code);
    pushCode(err?.cause?.code);
    for (const e of aggregateErrors) {
        pushCode(e?.code);
    }

    // Retry if we see any sign of a broken IPv6 route or connect timeout.
    // These happen before a request is sent, so retrying is safe.
    return codes.has("ENETUNREACH") || codes.has("EHOSTUNREACH") || codes.has("ETIMEDOUT");
}

function buildUrl(
    path: string,
    qp?: Record<string, any>,
    noPrefix?: boolean
): string {
    const absolute = /^https?:\/\//i.test(path);
    const p = path.startsWith("/") ? path : `/${path}`;
    const base = BACKEND_ORIGIN.replace(/\/+$/, "");
    const prefix =
        noPrefix || p.startsWith("/internal/") ? "" : BACKEND_PREFIX ? `/${BACKEND_PREFIX}` : "";
    const urlStr = absolute ? path : `${base}${prefix}${p}`;
    const url = new URL(urlStr);
    Object.entries(qp || {}).forEach(([k, v]) => {
        if (v != null) url.searchParams.set(k, String(v));
    });
    return url.toString();
}

function signUserCtx(userCtx: NonNullable<CallOpts["userCtx"]>) {
    const payload = Buffer.from(JSON.stringify(userCtx), "utf8").toString("base64");
    const sig = crypto.createHmac("sha256", INTERNAL_API_KEY).update(payload).digest("hex");
    return { payload, sig };
}

function readHeader(req: Reqish, name: string): string {
    if (!req) return "";
    if (typeof (req as any).get === "function") return ((req as any).get(name) as string) || "";
    const h = (req as any).headers;
    if (h?.get) return h.get(name) || "";
    if (h && typeof h === "object") {
        const n = name.toLowerCase();
        return (h[n] || h[name]) ?? "";
    }
    return "";
}

export async function callBackend(req: Reqish, opts: CallOpts) {
    if (!INTERNAL_API_KEY) throw new Error("INTERNAL_API_KEY not set");

    const method = (opts.method || "POST").toUpperCase() as NonNullable<CallOpts["method"]>;
    const url = buildUrl(opts.path, opts.query, opts.noPrefix === true);
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const bodyText = method === "GET" || method === "HEAD" || method === "OPTIONS" ? "" : JSON.stringify(opts.body ?? {});
    const bodySizeBytes = new TextEncoder().encode(bodyText).length;

    const inboundId = readHeader(req, "x-request-id");
    const reqId =
        inboundId ||
        (typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : crypto.randomBytes(8).toString("hex"));

    const signed = opts.userCtx ? signUserCtx(opts.userCtx) : null;

    let upstream: any;
    try {
        const doFetch = async (dispatcher?: Agent) => {
            const controller = new AbortController();
            const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
            const startedAt = Date.now();
            console.info("[app-embeddings][proxy] backend_request_start", {
                reqId,
                url,
                method,
                timeoutMs,
                bodySizeBytes,
            });
            try {
                const response = await undiciFetch(url, {
                    method,
                    headers: {
                        ...(opts.headers || {}),
                        "content-type": "application/json",
                        "cache-control": "no-store",
                        "x-request-id": reqId,
                        "x-internal-key": INTERNAL_API_KEY,
                        ...(signed
                            ? { "x-user-ctx": signed.payload, "x-user-ctx-sig": signed.sig }
                            : {}),
                        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
                    },
                    body: method === "GET" || method === "HEAD" || method === "OPTIONS" ? undefined : bodyText,
                    signal: controller.signal,
                    ...(dispatcher ? { dispatcher } : {}),
                });

                console.info("[app-embeddings][proxy] backend_response_received", {
                    reqId,
                    url,
                    method,
                    elapsedMs: Date.now() - startedAt,
                    status: response.status,
                    ok: response.ok,
                });
                return response;
            } finally {
                clearTimeout(timeoutHandle);
            }
        };

        // Default path: do not force IPv4 unless explicitly requested.
        if (shouldForceIpv4Always()) {
            upstream = await doFetch(getIpv4Dispatcher());
        } else {
            try {
                upstream = await doFetch(undefined);
            } catch (err: any) {
                // Surgical fallback: if the first attempt fails with a dual-stack connect signature,
                // retry once forcing IPv4.
                if (shouldRetryWithIpv4(err, url)) {
                    upstream = await doFetch(getIpv4Dispatcher());
                } else {
                    throw err;
                }
            }
        }
    } catch (err: any) {
        const aborted = err?.name === "AbortError";
        console.warn("[app-embeddings][proxy] backend_request_failed", {
            reqId,
            url,
            method,
            aborted,
            timeoutMs,
            bodySizeBytes,
            error: err?.message || String(err),
        });
        if (aborted && opts.acceptOnTimeout) {
            const json = { ok: true, queued: true, code: "TIMEOUT_ACCEPTED" };
            const fake = new Response(JSON.stringify(json), {
                status: 202,
                headers: { "content-type": "application/json" },
            });
            return {
                upstream: fake as any,
                status: 202,
                json,
                raw: JSON.stringify(json),
                reqId,
                url,
            };
        }
        const status = aborted ? 504 : 502;
        const json = { error: aborted ? "Backend timeout" : "Backend fetch failed" };
        return {
            upstream: new Response(JSON.stringify(json), {
                status,
                headers: { "content-type": "application/json" },
            }) as any,
            status,
            json,
            raw: JSON.stringify(json),
            reqId,
            url,
        };
    } finally {
    }

    const raw = await upstream.text();
    let json: any;
    try {
        json = JSON.parse(raw);
    } catch {
        json = { ok: upstream.ok, data: raw };
    }

    return { upstream, status: upstream.status, json, raw, reqId, url };
}
