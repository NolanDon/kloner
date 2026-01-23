import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { assertAppBuilderScope } from "../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchFlyMachineState(app: string, machineId: string) {
    const token = (() => {
        const raw = (process.env.FLY_API_TOKEN || "").trim();
        if (!raw) return "";

        // IMPORTANT:
        // FlyV1 tokens can include a comma-separated third-party discharge token.
        // Do NOT split on commas, or Fly will reject the macaroon as incomplete.
        // If someone pastes multiple tokens accidentally, they should be separated
        // by newlines; in that case, prefer the first non-empty line.
        const firstLine = raw
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)[0];

        return (firstLine || raw).trim().replace(/^"|"$/g, "");
    })();
    if (!token) {
        return { ok: false as const, status: 500, error: "FLY_API_TOKEN not set" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const url = `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machineId)}`;
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "accept": "application/json",
                "authorization": `Bearer ${token}`,
            },
            cache: "no-store",
            signal: controller.signal,
        });

        const json = await res.json().catch(() => ({} as any));
        if (!res.ok) {
            const msg = String(
                (json as any)?.error ||
                (json as any)?.message ||
                `Fly error (HTTP ${res.status})`
            );
            return {
                ok: false as const,
                status: res.status,
                error:
                    (process.env.NODE_ENV !== "production" && (res.status === 401 || res.status === 403))
                        ? `${msg} (Fly API rejected token; ensure FLY_API_TOKEN is a single valid token and restart dev server)`
                        : msg,
            };
        }

        const state = typeof (json as any)?.state === "string" ? (json as any).state : undefined;
        return { ok: true as const, status: 200, state };
    } catch (err: any) {
        const aborted = err?.name === "AbortError";
        return { ok: false as const, status: aborted ? 504 : 502, error: aborted ? "Timeout" : "Fetch failed" };
    } finally {
        clearTimeout(timeout);
    }
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const app = (url.searchParams.get("app") || "").trim();
    const machineId = (url.searchParams.get("machineId") || "").trim();
    const appId = (url.searchParams.get("appId") || "").trim();

    if (!app || !machineId || !appId) {
        return NextResponse.json(
            { ok: false, reason: "missing_params", error: "Missing app, machineId, or appId" },
            { status: 400 }
        );
    }

    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            assertAppBuilderScope(authedReq, uid, appId);

            const r = await fetchFlyMachineState(app, machineId);
            if (!r.ok) {
                return NextResponse.json(
                    { ok: false, reason: "fly_error", error: r.error },
                    { status: r.status }
                );
            }

            return NextResponse.json({ ok: true, state: r.state });
        },
        { csrf: false, methods: ["GET"] }
    );
}
