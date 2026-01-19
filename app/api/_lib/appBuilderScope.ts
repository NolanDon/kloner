import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

const COOKIE_NAME = "ab_scope";

type ScopePayload = {
    uid: string;
    appId: string;
    exp: number; // unix seconds
    nonce: string;
};

function base64url(input: Buffer | string): string {
    const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
    return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function unbase64url(input: string): Buffer {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
    return Buffer.from(padded, "base64");
}

function safeEqual(a: string, b: string): boolean {
    const A = Buffer.from(a, "utf8");
    const B = Buffer.from(b, "utf8");
    return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function getSecret(): string {
    const secret = process.env.APP_BUILDER_SCOPE_SECRET;
    if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
        throw new Error("APP_BUILDER_SCOPE_SECRET must be set (>= 32 chars) in production");
    }
    return secret || "dev-only-insecure-app-builder-scope-secret";
}

function sign(payloadB64: string): string {
    const secret = getSecret();
    return base64url(crypto.createHmac("sha256", secret).update(payloadB64).digest());
}

export function issueAppBuilderScopeCookie(res: NextResponse, uid: string, appId: string) {
    const payload: ScopePayload = {
        uid,
        appId,
        exp: Math.floor(Date.now() / 1000) + 60 * 30, // 30 minutes
        nonce: crypto.randomBytes(16).toString("hex"),
    };

    const payloadB64 = base64url(JSON.stringify(payload));
    const sigB64 = sign(payloadB64);
    const token = `${payloadB64}.${sigB64}`;

    res.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 30,
    });
}

export function assertAppBuilderScope(req: NextRequest, uid: string, appId: string) {
    const token = req.cookies.get(COOKIE_NAME)?.value || "";
    if (!token) {
        throw Object.assign(new Error("Missing app scope"), {
            status: 403,
            code: "MISSING_APP_SCOPE",
            uid,
            appId,
        });
    }

    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) {
        throw Object.assign(new Error("Invalid app scope"), {
            status: 403,
            code: "INVALID_APP_SCOPE",
            uid,
            appId,
        });
    }

    const expected = sign(payloadB64);
    if (!safeEqual(sigB64, expected)) {
        throw Object.assign(new Error("Invalid app scope"), {
            status: 403,
            code: "INVALID_APP_SCOPE",
            uid,
            appId,
        });
    }

    let payload: ScopePayload;
    try {
        payload = JSON.parse(unbase64url(payloadB64).toString("utf8"));
    } catch {
        throw Object.assign(new Error("Invalid app scope"), {
            status: 403,
            code: "INVALID_APP_SCOPE",
            uid,
            appId,
        });
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.exp < now) {
        throw Object.assign(new Error("Expired app scope"), {
            status: 403,
            code: "EXPIRED_APP_SCOPE",
            uid,
            appId,
        });
    }

    if (payload.uid !== uid || payload.appId !== appId) {
        throw Object.assign(new Error("App scope mismatch"), {
            status: 403,
            code: "APP_SCOPE_MISMATCH",
            uid,
            appId,
        });
    }
}
