import crypto from "node:crypto";

function baseUrl() {
    const v = (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
    if (v) return v.replace(/\/$/, "");
    return "https://kloner.app";
}

function getEmailLinkSecret(): string {
    const s = (process.env.EMAIL_LINK_SECRET || "").trim();
    if (!s) throw new Error("EMAIL_LINK_SECRET env not set");
    return s;
}

function hmacBase64Url(secret: string, msg: string): string {
    return crypto.createHmac("sha256", secret).update(msg).digest("base64url");
}

function makeSignedToken(payload: Record<string, any>): string {
    const secret = getEmailLinkSecret();
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = hmacBase64Url(secret, body);
    return `${body}.${sig}`;
}

export { makeSignedToken };

export function makeUnsubUrl(params: { uid: string; kind: "journey" | "product" | "all" }) {
    const u = new URL(`${baseUrl()}/api/email/unsubscribe`);
    const token = makeSignedToken({ uid: params.uid, k: params.kind, ts: Date.now() });
    u.searchParams.set("t", token);
    return u.toString();
}