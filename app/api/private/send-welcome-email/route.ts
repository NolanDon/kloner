// app/api/private/send-welcome-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { assertCsrf, verifySession } from "../../_lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

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
};

function buildWelcomeHtml(email: string, name: string | undefined) {
    const accent = "#f55f2a";
    const dark = "#111827";
    const muted = "#4b5563";

    const safeName = name && name.trim().length > 0 ? name.trim() : "there";

    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>Welcome to Kloner</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid #f3f4f6;background:radial-gradient(circle at top left,#fde7d7,#ffffff);">
                <div style="display:flex;align-items:center;gap:12px;">
                  <div style="width:40px;height:40px;border-radius:14px;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px;">K</div>
                  <div>
                    <div style="font-size:16px;font-weight:600;color:${dark};">Welcome to Kloner</div>
                    <div style="font-size:12px;color:${muted};margin-top:2px;">Clone a site, customize it, and deploy in a few clicks.</div>
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <p style="margin:0 0 12px 0;font-size:14px;color:${dark};">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 12px 0;font-size:13px;color:${muted};line-height:1.6;">
                  Thanks for signing up for <strong>Kloner</strong>, your website cloner with one-click deploy.
                </p>
                <p style="margin:0 0 14px 0;font-size:13px;color:${muted};line-height:1.6;">
                  You can paste any public URL, capture a clean snapshot, and turn it into an editable project without touching the original site. Once you like the result, deploy it to your own space and keep iterating visually.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 4px 0;">
                  <tr>
                    <td>
                      <a href="https://kloner.app/dashboard" style="display:inline-block;background:${accent};color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:999px;">
                        Open your Kloner dashboard
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:16px 0 4px 0;font-size:12px;color:${muted};font-weight:600;">
                  What you can do next:
                </p>
                <ul style="margin:4px 0 0 18px;padding:0;font-size:12px;color:${muted};line-height:1.6;">
                  <li>Paste a URL and generate a base screenshot.</li>
                  <li>Create editable previews that mirror the original layout.</li>
                  <li>Swap text and assets to make it yours.</li>
                  <li>Deploy with one click when you’re happy.</li>
                </ul>
              </td>
            </tr>

            <tr>
              <td style="padding:12px 28px 20px 28px;">
                <p style="margin:12px 0 6px 0;font-size:12px;color:${muted};">
                  If you have any questions or need help with your first deployment, reply to this email or contact us at
                  <a href="mailto:support@kloner.app" style="color:${accent};text-decoration:none;">support@kloner.app</a>.
                </p>
                <p style="margin:0;font-size:12px;color:${muted};">
                  – The Kloner team
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
                <div style="font-size:11px;color:#9ca3af;">
                  This email was sent to ${email}. If you didn’t create a Kloner account, you can ignore this message.
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

        const email = body.email;
        if (!email) {
            return NextResponse.json(
                { error: "Missing email for welcome" },
                { status: 400 }
            );
        }

        const from = process.env.WELCOME_EMAIL_FROM || "hello@kloner.app";
        if (!from) {
            return NextResponse.json(
                { error: "WELCOME_EMAIL_FROM env not set" },
                { status: 500 }
            );
        }

        const name = body.name || decoded.name || "";
        const html = buildWelcomeHtml(email, name);
        const text =
            `Hi ${name || "there"},\n\n` +
            `Thanks for signing up for Kloner. You can now paste a URL, generate a base screenshot, create an editable preview, and deploy with one click.\n\n` +
            `Open your dashboard: https://kloner.app/dashboard\n\n` +
            `If you have any questions, email support@kloner.app.\n\n` +
            `– The Kloner team`;

        const resend = getResend();
        const result = await resend.emails.send({
            from,
            to: email,
            subject: "Welcome to Kloner",
            text,
            html,
        });

        if ("error" in result && result.error) {
            console.error("Resend error (welcome):", result.error);
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
        console.error("send-welcome-email failed:", err);
        const msg = typeof err?.message === "string" ? err.message : "Internal error";
        const status = /env not set|RESEND_API_KEY|WELCOME_EMAIL_FROM/i.test(msg)
            ? 500
            : 400;
        return NextResponse.json(
            { error: msg },
            { status, headers: { "Cache-Control": "no-store" } }
        );
    }
}
