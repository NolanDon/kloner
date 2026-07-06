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

function verifySignedToken(token: string): Record<string, any> | null {
    const t = (token || "").trim();
    const m = t.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    const body = m[1]!;
    const sig = m[2]!;
    const expected = hmacBase64Url(getEmailLinkSecret(), body);
    if (expected !== sig) return null;
    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
        return null;
    }
}

export { makeSignedToken, verifySignedToken };

export function makeUnsubUrl(params: { uid: string; kind: "journey" | "product" | "all" }) {
    const u = new URL(`${baseUrl()}/api/email/unsubscribe`);
    const token = makeSignedToken({ uid: params.uid, k: params.kind, ts: Date.now() });
    u.searchParams.set("t", token);
    return u.toString();
}

export function makeRecoveryCheckoutUrl(params: { uid: string; kind: "exit40" }) {
    const u = new URL(`${baseUrl()}/api/billing/recovery-checkout`);
    const token = makeSignedToken({ uid: params.uid, k: params.kind, ts: Date.now() });
    u.searchParams.set("t", token);
    return u.toString();
}
