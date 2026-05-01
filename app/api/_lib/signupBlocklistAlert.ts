import "server-only";

import { Resend } from "resend";
import { captureCriticalEvent } from "@/lib/observability";

const SUPPORT_TO = process.env.SUPPORT_TO || "support@kloner.app";

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function clean(value: string | null | undefined, max = 500): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function sendBlockedSignupIpAlert(params: {
    ip: string;
    email?: string | null;
    route: string;
    matchedBy: "ip";
    userAgent?: string | null;
}) {
    const ip = clean(params.ip, 120);
    if (!ip) return;

    const email = clean(params.email, 320) || "-";
    const route = clean(params.route, 200) || "unknown";
    const userAgent = clean(params.userAgent, 500) || "-";
    const from = process.env.ALERT_EMAIL_FROM || "support@kloner.app";

    try {
        const resend = getResend();
        const subject = `Kloner · Blocked signup IP: ${ip}`;
        const text = [
            "Blocked signup attempt detected.",
            `IP: ${ip}`,
            `Email: ${email}`,
            `Route: ${route}`,
            `Matched by: ${params.matchedBy}`,
            `User-Agent: ${userAgent}`,
            `Timestamp: ${new Date().toISOString()}`,
        ].join("\n");

        await resend.emails.send({
            from,
            to: SUPPORT_TO,
            subject,
            text,
        });
    } catch (error) {
        await captureCriticalEvent({
            source: "internal",
            severity: "error",
            statusCode: 500,
            route,
            method: "POST",
            action: "signup.blocked_ip_alert.failed",
            message: error instanceof Error ? error.message : "Blocked signup alert failed",
            service: "signup-blocklist",
            tags: ["signup", "blocklist", "alert-failed"],
            extra: {
                blockedIp: ip,
                blockedEmail: email,
            },
        }).catch(() => null);
    }
}