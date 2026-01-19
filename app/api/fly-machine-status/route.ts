import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLY_API_BASE = "https://api.machines.dev/v1";

function jsonError(message: string, status: number, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

async function fetchFlyMachine(app: string, machineId: string) {
  const token = process.env.FLY_API_TOKEN;
  if (!token) {
    return { ok: false as const, reason: "missing_token" as const };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(`${FLY_API_BASE}/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machineId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false as const,
          reason: "not_found" as const,
          status: res.status,
          body: json,
        };
      }
      return {
        ok: false as const,
        reason: "fly_error" as const,
        status: res.status,
        body: json,
      };
    }

    const state = (json as any)?.state as string | undefined;
    return {
      ok: true as const,
      state,
      raw: json,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const app = url.searchParams.get("app")?.trim() || "";
  const machineId = url.searchParams.get("machineId")?.trim() || "";

  if (!app || !machineId) {
    return jsonError("Missing app or machineId", 400);
  }

  return requireSessionAndMaybeCsrf(
    request,
    async () => {
      const result = await fetchFlyMachine(app, machineId);

      if (!result.ok) {
        if (result.reason === "missing_token") {
          return NextResponse.json({ ok: false, reason: "missing_token" }, { status: 200 });
        }
        if (result.reason === "not_found") {
          return NextResponse.json({ ok: false, reason: "not_found" }, { status: 200 });
        }
        return jsonError("Fly Machines API error", 502, {
          flyStatus: result.status,
          flyBody: result.body,
        });
      }

      return NextResponse.json({ ok: true, app, machineId, state: result.state }, { status: 200 });
    },
    { csrf: false, methods: ["GET"] }
  );
}
