import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { assertAppBuilderScope } from "../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedProbeTarget(u: URL): boolean {
    const host = (u.hostname || "").toLowerCase();

    // Always allow local dev.
    if (host === "localhost" || host === "127.0.0.1") return true;

    // Allow Fly default domains.
    if (host.endsWith(".fly.dev")) return true;

    // Optional allowlist for custom domains.
    const raw = process.env.PREVIEW_PROBE_ALLOWLIST || "";
    const allow = raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

    if (allow.length && allow.includes(host)) return true;

    return false;
}

async function probe(url: string) {
    const controller = new AbortController();
    // The hub can cold-start or briefly stall on first request; keep this lenient to avoid
    // incorrectly throwing away a perfectly good existing machine.
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const u = new URL(url);

        // Only permit http(s).
        if (u.protocol !== "https:" && u.protocol !== "http:") {
            return { reachable: false, status: 400, error: "Invalid protocol" };
        }

        // SSRF guard.
        if (!isAllowedProbeTarget(u)) {
            return { reachable: false, status: 400, error: "Host not allowed" };
        }

        // Probe the full URL (path + query). Probing only the origin can
        // falsely succeed even when the specific preview code no longer routes.
        const target = new URL(u.toString());

        const res = await fetch(target.toString(), {
            method: "GET",
            redirect: "follow",
            cache: "no-store",
            signal: controller.signal,
            headers: {
                // Avoid large payloads; we only need headers/availability.
                "accept": "text/html,application/json;q=0.9,*/*;q=0.1",
                "user-agent": "kloner-probe/1.0",
            },
        });

        // NOTE: the preview system may intentionally redirect (e.g. to establish
        // sticky routing cookies). Same-origin redirects are therefore expected
        // and should NOT be treated as unreachable.
        let finalUrl: string | null = null;
        let crossOriginRedirect = false;
        try {
            finalUrl = res.url || null;
            if (finalUrl) {
                const final = new URL(finalUrl);
                crossOriginRedirect = final.origin !== target.origin;
            }
        } catch {
            // ignore
        }

        // Treat only 2xx/3xx responses on the allowed host as reachable.
        // IMPORTANT: 404/4xx often means the preview code/token is stale or expired.
        // We must not treat those as reachable, otherwise the UI can show a "Not Found"
        // page while claiming the preview is active.
        const reachable = res.status >= 200 && res.status < 400 && !crossOriginRedirect;
        return {
            reachable,
            status: res.status,
            finalUrl,
            redirected: Boolean(res.redirected),
            crossOriginRedirect,
        };
    } catch (e: any) {
        const aborted = e?.name === "AbortError";
        return { reachable: false, status: aborted ? 504 : 502, error: aborted ? "Timeout" : "Fetch failed" };
    } finally {
        clearTimeout(timeout);
    }
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const targetUrl = url.searchParams.get("url") || "";
    const appId = url.searchParams.get("appId") || "";

    if (!targetUrl || !appId) {
        return NextResponse.json({ ok: false, error: "Missing url or appId" }, { status: 400 });
    }

    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            // Prevent request tampering: must match the active app scope cookie.
            assertAppBuilderScope(authedReq, uid, appId);

            const r = await probe(targetUrl);
            return NextResponse.json({ ok: true, ...r });
        },
        { csrf: false, methods: ["GET"] },
    );
}
