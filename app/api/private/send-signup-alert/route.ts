// app/api/private/send-signup-alert/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { assertCsrf, verifySession } from "../../_lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const SUPPORT_TO = process.env.SUPPORT_TO || "support@kloner.app";

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

type SignupPayload = {
    uid?: string;
    email?: string;
    name?: string;
    plan?: string;
    createdAt?: string | number;
    source?: string;
    method?: string;
    notes?: string;
};

function buildSupportHtml(p: Required<SignupPayload>) {
    const accent = "#f55f2a";
    const muted = "#4b5563";

    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>Kloner · New signup</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #f3f4f6;background:linear-gradient(135deg,#ffffff,#fef2e2);">
                <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:32px;height:32px;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${accent};">
                    <img
                    src="https://kloner.app/images/logo.png"
                    alt="Kloner"
                    style="width:100%;height:100%;object-fit:cover;display:block;"
                    />
                </div>
                <div>
                    <div style="font-size:14px;font-weight:600;color:#111827;">Kloner · New signup</div>
                    <div style="font-size:12px;color:${muted};margin-top:2px;">A new user just created an account.</div>
                </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 24px;">
                <p style="margin:0 0 12px 0;font-size:13px;color:${muted};">
                  A new Kloner account has been created. Details below.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:13px;color:#111827;margin-top:8px;">
                  <tr>
                    <td style="padding:4px 0;width:120px;color:${muted};">Email</td>
                    <td style="padding:4px 0;font-weight:500;">${p.email}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${muted};">UID</td>
                    <td style="padding:4px 0;font-family:ui-monospace,Menlo,Consolas,monospace;">${p.uid}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${muted};">Name</td>
                    <td style="padding:4px 0;">${p.name || "–"}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${muted};">Plan</td>
                    <td style="padding:4px 0;">${p.plan}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${muted};">Method</td>
                    <td style="padding:4px 0;">${p.method}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${muted};">Created at</td>
                    <td style="padding:4px 0;">${p.createdAt}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${muted};">Source</td>
                    <td style="padding:4px 0;">${p.source}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:${muted};">Notes</td>
                    <td style="padding:4px 0;">${p.notes}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 24px;border-top:1px solid #f3f4f6;background:#fafafa;">
                <div style="font-size:11px;color:#9ca3af;">
                  This alert was sent to support@kloner.app from your Kloner app.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export async function POST(req: NextRequest) {
    try {
        assertCsrf(req);
    } catch (e: any) {
        const status = e?.status || 403;
        return NextResponse.json(
            { error: e?.message || "Forbidden (csrf)" },
            { status }
        );
    }

    let decoded;
    try {
        decoded = await verifySession(req);
    } catch (e: any) {
        const status = e?.status || 401;
        return NextResponse.json(
            { error: e?.message || "Unauthorized" },
            { status }
        );
    }

    try {
        const body = (await req.json()) as SignupPayload;

        if (body.uid && body.uid !== decoded.uid) {
            return NextResponse.json({ error: "UID mismatch" }, { status: 403 });
        }
        if (!body.email && decoded.email) {
            body.email = decoded.email;
        }
        if (!body.uid) body.uid = decoded.uid;

        if (!body?.email && !body?.uid) {
            return NextResponse.json(
                { error: "Missing email or uid" },
                { status: 400 }
            );
        }

        const from = process.env.ALERT_EMAIL_FROM || "support@kloner.app";
        if (!from) {
            return NextResponse.json(
                { error: "ALERT_EMAIL_FROM env not set" },
                { status: 500 }
            );
        }

        const {
            uid = "-",
            email = "-",
            name = "-",
            plan = "free",
            createdAt = new Date().toISOString(),
            source = "kloner_login_page",
            method = "email",
            notes = "-",
        } = body;

        const subject = `Kloner · New signup: ${email !== "-" ? email : uid}`;
        const text =
            `New Kloner signup\n` +
            `UID: ${uid}\nEmail: ${email}\nName: ${name}\nPlan: ${plan}\nMethod: ${method}\n` +
            `Created At: ${createdAt}\nSource: ${source}\nNotes: ${notes}\n`;

        const resend = getResend();
        const html = buildSupportHtml({
            uid,
            email,
            name,
            plan,
            createdAt,
            source,
            method,
            notes,
        });

        const result = await resend.emails.send({
            from,
            to: SUPPORT_TO,
            subject,
            text,
            html,
        });

        if ("error" in result && result.error) {
            console.error("Resend error (support):", result.error);
            return NextResponse.json(
                { error: result.error.message || "Email send failed" },
                { status: 502 }
            );
        }

        return NextResponse.json(
            { ok: true, id: result.data?.id ?? null },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (err: any) {
        console.error("send-signup-alert failed:", err);
        const msg = typeof err?.message === "string" ? err.message : "Internal error";
        const status = /env not set|RESEND_API_KEY|ALERT_EMAIL_FROM/i.test(msg) ? 500 : 400;
        return NextResponse.json(
            { error: msg },
            { status, headers: { "Cache-Control": "no-store" } }
        );
    }
}
