import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { verifySession, getAdminDb, SESSION_COOKIE_NAME } from "../../../_lib/auth";
import { FieldValue } from "firebase-admin/firestore";
import { captureCriticalEvent } from "@/lib/observability";
import { redactDiagnosticUrl } from "@/lib/diagnostic-url";
import { encryptString } from "../../../_lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function digest(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function matchesState(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(req: NextRequest) {
    const base = process.env.NODE_ENV === "production"
        ? process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app"
        : process.env.OAUTH_REDIRECT_BASE_DEV || "http://localhost:3000";
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = req.cookies.get("vercel_oauth_state")?.value;
    const teamId = url.searchParams.get("teamId") || undefined;
    const configurationId = url.searchParams.get("configurationId") || undefined;
    const header = (key: string) => (req.headers.get(key) || "").slice(0, 500);
    const requestId = header("x-vercel-id") || header("x-request-id") || randomUUID();
    const requestIdSource = header("x-vercel-id") ? "x-vercel-id" : header("x-request-id") ? "client x-request-id (unverified)" : "generated";
    const ipHeader = ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"].find(key => header(key));
    const ip = ipHeader ? header(ipHeader).split(",")[0].trim() : "not recorded by request headers";
    const hasSession = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);
    let uid: string | undefined;
    let email: string | undefined;
    let identityStatus = hasSession ? "session not yet verified" : "no session cookie";

    const redirectWithStatus = (status: "success" | "error", reason?: string) => {
        let target = new URL("/integrations/vercel/callback", base);
        if (status === "success") {
            try {
                const returnPath = decodeURIComponent(req.cookies.get("vercel_oauth_return")?.value || "");
                const candidate = new URL(returnPath, base);
                if (returnPath.startsWith("/") && !returnPath.startsWith("//") && candidate.origin === new URL(base).origin) target = candidate;
            } catch { /* Use the default callback page. */ }
        }
        target.searchParams.set("status", status);
        if (reason) target.searchParams.set("reason", reason);
        target.searchParams.set("requestId", requestId);
        const res = NextResponse.redirect(target.toString(), { status: 302 });
        res.headers.set("x-kloner-request-id", requestId);
        res.headers.set("Cache-Control", "no-store");
        for (const cookie of ["vercel_oauth_state", "vercel_oauth_return"]) {
            res.cookies.set(cookie, "", { maxAge: 0, path: "/" });
        }
        return res;
    };

    const report = async (statusCode: number, reason: string, message: string, details: Record<string, unknown> = {}) => {
        const context = {
            identityStatus,
            hasSession,
            hasCode: Boolean(code),
            hasQueryState: Boolean(state),
            hasStateCookie: Boolean(cookieState),
            stateMatches: Boolean(state && cookieState && matchesState(state, cookieState)),
            stateFingerprint: state ? digest(state) : "missing",
            queryTeamId: teamId || "missing (unverified query parameter)",
            queryConfigurationId: configurationId || "missing",
            flowSourceClaim: url.searchParams.get("source") || "missing",
            ip,
            ipSource: ipHeader || "none",
            userAgent: header("user-agent") || "missing",
            fetchSite: header("sec-fetch-site") || "missing",
            origin: header("origin") ? redactDiagnosticUrl(header("origin")) : "missing",
            referer: header("referer") ? redactDiagnosticUrl(header("referer")) : "missing",
            requestIdSource,
            reason,
            httpResponseStatus: 302,
            ...(email ? { verifiedUserEmail: email } : {}),
            ...details,
            // Group the same flow's failures for five minutes; retain every event.
            oauthIncidentKey: [reason, state ? digest(state) : "missing", teamId || "", digest(ip), digest(header("user-agent")), uid || "unverified", Math.floor(Date.now() / 300_000)].join("|"),
        };
        console.warn("[vercel-oauth] callback rejected", { requestId, userId: uid || "unverified", ...context });
        await captureCriticalEvent({
            source: "vercel", component: "nextjs-server",
            severity: statusCode >= 500 ? "critical" : "error",
            statusCode, route: "/api/vercel/oauth/callback", method: "GET",
            action: "vercel.oauth.callback", message, service: "vercel-oauth",
            userId: uid, requestId, url: redactDiagnosticUrl(req.url), extra: context,
        });
    };

    try {
        let decoded;
        try {
            decoded = await verifySession(req);
        } catch (err) {
            const error = err as { status?: number; authCode?: string; authVerificationUnavailable?: boolean };
            const authCode = error?.authCode || "unknown";
            const infrastructureFailure = error?.status !== 401 || error?.authVerificationUnavailable === true || ["auth/internal-error", "auth/invalid-credential", "auth/insufficient-permission", "auth/project-not-found"].includes(authCode);
            identityStatus = !hasSession ? "no session cookie" : infrastructureFailure ? "session verification unavailable" : "session cookie rejected";
            await report(infrastructureFailure ? 500 : 401, infrastructureFailure ? "internal" : "auth",
                infrastructureFailure ? "OAuth session verification failed due to a server error" : hasSession ? "OAuth callback rejected: session cookie could not be verified" : "OAuth callback rejected: no Kloner session cookie",
                { authFailureCode: !hasSession ? "SESSION_COOKIE_MISSING" : authCode });
            return redirectWithStatus("error", infrastructureFailure ? "internal" : "auth");
        }
        uid = decoded.uid;
        email = typeof decoded.email === "string" ? decoded.email : undefined;
        identityStatus = "verified Kloner session";

        if (!code) {
            await report(400, "token", "OAuth callback rejected: missing authorization code");
            return redirectWithStatus("error", "token");
        }
        if (!state || !cookieState || !matchesState(state, cookieState)) {
            await report(403, "state", "OAuth callback rejected: missing or mismatched OAuth state");
            return redirectWithStatus("error", "state");
        }

        const redirectUri = process.env.VERCEL_OAUTH_REDIRECT_URI;
        const clientId = process.env.VERCEL_OAUTH_CLIENT_ID;
        const clientSecret = process.env.VERCEL_OAUTH_CLIENT_SECRET;
        if (!redirectUri || !clientId || !clientSecret) {
            await report(500, "config", "Vercel OAuth configuration is incomplete", {
                hasRedirectUri: Boolean(redirectUri), hasClientId: Boolean(clientId), hasClientSecret: Boolean(clientSecret),
            });
            return redirectWithStatus("error", "config");
        }
        let json: any;
        try {
            const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
                method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
                signal: AbortSignal.timeout(15_000),
            });
            if (!tokenRes.ok) {
                await report(502, "token", "Vercel OAuth token exchange failed", { providerStatus: tokenRes.status });
                return redirectWithStatus("error", "token");
            }
            json = await tokenRes.json();
        } catch {
            await report(502, "token", "Vercel OAuth token exchange unavailable or timed out");
            return redirectWithStatus("error", "token");
        }
        const accessToken = typeof json?.access_token === "string" ? json.access_token.trim() : "";
        if (!accessToken) {
            await report(502, "token", "Vercel OAuth response omitted the access token");
            return redirectWithStatus("error", "token");
        }
        try {
            const now = FieldValue.serverTimestamp();
            await getAdminDb().collection("kloner_users").doc(uid!).collection("integrations").doc("vercel").set({
                accessToken: encryptString(accessToken), tokenType: json.token_type ?? null,
                vercelUserId: json.user_id ?? null, vercelTeamId: json.team_id ?? teamId ?? null,
                configurationId: configurationId ?? null, scope: json.scope ?? null,
                updatedAt: now, createdAt: now, connected: true,
            }, { merge: true });
        } catch {
            await report(500, "db", "Vercel OAuth integration could not be saved");
            return redirectWithStatus("error", "db");
        }
        return redirectWithStatus("success");
    } catch {
        await report(500, "internal", "Unexpected Vercel OAuth callback failure");
        return redirectWithStatus("error", "internal");
    }
}
