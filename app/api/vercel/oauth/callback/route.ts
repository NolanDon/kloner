// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySession, getAdminDb } from "../../../_lib/auth";
import { FieldValue } from "firebase-admin/firestore";
import { captureCriticalEvent, captureException } from "@/lib/observability";
import { encryptString } from "../../../_lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {

    const isProd = process.env.NODE_ENV === "production";

    const base = isProd ? (process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app") : process.env.OAUTH_REDIRECT_BASE_DEV

    // delete-me
    // const base = process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app";

    const redirectWithStatus = (
        status: "success" | "error",
        reason?: string,
    ) => {
        const returnCookie = req.cookies.get("vercel_oauth_return")?.value;

        // If we have an explicit return target and the flow was successful,
        // send the user straight back there (e.g. /dashboard/view?vercel=connected).
        if (status === "success" && returnCookie) {
            let target: URL;
            try {
                target = new URL(returnCookie, base);
            } catch {
                target = new URL("/integrations/vercel/callback", base);
                target.searchParams.set("status", status);
                if (reason) target.searchParams.set("reason", reason);
            }

            const res = NextResponse.redirect(target.toString(), { status: 302 });
            res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
            res.cookies.set("vercel_oauth_return", "", { maxAge: 0, path: "/" });
            return res;
        }

        // default behaviour (existing callback page)
        const next = new URL("/integrations/vercel/callback", base);
        next.searchParams.set("status", status);
        if (reason) next.searchParams.set("reason", reason);

        const res = NextResponse.redirect(next.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        if (returnCookie) {
            res.cookies.set("vercel_oauth_return", "", { maxAge: 0, path: "/" });
        }
        return res;
    };

    const reportOauthIssue = async (statusCode: number, reason: string, message: string, extra?: Record<string, unknown>) => {
        await captureCriticalEvent({
            source: "vercel",
            severity: statusCode >= 500 ? "critical" : "error",
            statusCode,
            route: req.nextUrl?.pathname,
            method: "GET",
            action: "vercel.oauth.callback",
            message,
            service: "vercel-oauth",
            url: req.url,
            extra: {
                reason,
                ...extra,
            },
        });
    };

    try {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const teamId = url.searchParams.get("teamId") || undefined;
        const configurationId =
            url.searchParams.get("configurationId") || undefined;

        const cookieState = req.cookies.get("vercel_oauth_state")?.value;

        if (!code) {
            console.warn("[vercel-oauth] missing code param");
            await reportOauthIssue(400, "token", "Missing code param");
            return redirectWithStatus("error", "token");
        }

        if (cookieState && state !== cookieState) {
            console.warn("[vercel-oauth] state mismatch", {
                code: !!code,
                state,
                cookieState,
            });
            await reportOauthIssue(400, "state", "OAuth state mismatch");
            return redirectWithStatus("error", "state");
        }

        let decoded;
        try {
            decoded = await verifySession(req);
        } catch (err) {
            console.error("[vercel-oauth] verifySession failed", err);
            await reportOauthIssue(401, "auth", "verifySession failed");
            return redirectWithStatus("error", "auth");
        }

        const uid = decoded.uid as string;

        // CRITICAL: must equal Vercel Integration Redirect URL and /start redirect_uri
        const redirectUri = process.env.VERCEL_OAUTH_REDIRECT_URI;
        if (!redirectUri) {
            console.error(
                "[vercel-oauth] VERCEL_OAUTH_REDIRECT_URI env missing during token exchange",
            );
            await reportOauthIssue(500, "config", "VERCEL_OAUTH_REDIRECT_URI env missing");
            return redirectWithStatus("error", "config");
        }

        const body = new URLSearchParams({
            code,
            client_id: process.env.VERCEL_OAUTH_CLIENT_ID || "",
            client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET || "",
            redirect_uri: redirectUri,
        });

        let json: any;
        try {
            const tokenRes = await fetch(
                "https://api.vercel.com/v2/oauth/access_token",
                {
                    method: "POST",
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    body,
                },
            );

            if (!tokenRes.ok) {
                const text = await tokenRes.text();
                console.error(
                    "[vercel-oauth] token exchange failed",
                    tokenRes.status,
                    text,
                );
                await reportOauthIssue(502, "token", "Token exchange failed", {
                    providerStatus: tokenRes.status,
                });
                return redirectWithStatus("error", "token");
            }

            json = await tokenRes.json();
        } catch (err) {
            console.error("[vercel-oauth] token exchange threw", err);
            await reportOauthIssue(502, "token", "Token exchange threw");
            return redirectWithStatus("error", "token");
        }

        const db = getAdminDb();
        const now = FieldValue.serverTimestamp();
        const accessToken = typeof json.access_token === "string" ? json.access_token.trim() : "";

        if (!accessToken) {
            console.error("[vercel-oauth] token exchange response missing access_token", json);
            await reportOauthIssue(502, "token", "Token exchange returned no access token");
            return redirectWithStatus("error", "token");
        }

        try {
            const userRef = db.collection("kloner_users").doc(uid);
            const vercelRef = userRef.collection("integrations").doc("vercel");

            await vercelRef.set(
                {
                    accessToken: encryptString(accessToken),
                    tokenType: json.token_type,
                    vercelUserId: json.user_id ?? null,
                    vercelTeamId: teamId ?? json.team_id ?? null,
                    configurationId: configurationId ?? null,
                    scope: json.scope ?? null,
                    updatedAt: now,
                    createdAt: now,
                    connected: true,
                },
                { merge: true },
            );
        } catch (err) {
            console.error("[vercel-oauth] Firestore write failed", err, { uid });
            await reportOauthIssue(500, "db", "Firestore write failed", { uid });
            return redirectWithStatus("error", "db");
        }

        return redirectWithStatus("success");
    } catch (err) {
        console.error("[vercel-oauth] unexpected error", err);
        await captureException({
            source: "vercel",
            error: err,
            route: req.nextUrl?.pathname,
            method: "GET",
            action: "vercel.oauth.callback",
            statusCode: 500,
            service: "vercel-oauth",
            url: req.url,
        });
        return redirectWithStatus("error", "internal");
    }
}
