// app/api/private/send-welcome-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { verifySession } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const WELCOME_SENDER = "Nolan From Kloner <hello@kloner.app>";

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

function buildWelcomeHtml(email: string, name?: string) {
  const safeName = name?.trim() || "there";

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Welcome to Kloner</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
          <tr>
            <td style="font-size:15px;line-height:1.65;">
              <p style="margin:0 0 16px 0;">
                Hey ${safeName},
              </p>

              <p style="margin:0 0 16px 0;">
                Kloner helps you clone a site and edit the preview visually.
              </p>

              <p style="margin:0 0 20px 0;">
                Drop a site link to get started, then make changes in the editor.
              </p>

              <p style="margin:0;">
                — The Kloner team
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding-top:24px;font-size:12px;color:#9ca3af;">
              This email was sent to ${email}.
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
  return requireSessionAndMaybeCsrf(
    req,
    async ({ req }) => {
      let decoded: any;
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
          return NextResponse.json(
            { error: "UID mismatch" },
            { status: 403 }
          );
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

        const from = process.env.WELCOME_EMAIL_FROM || WELCOME_SENDER;
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
          `Thanks for signing up for Kloner. Drop a site link to clone it and edit the preview visually.\n\n` +
          `Open your dashboard: https://kloner.app/dashboard\n\n` +
          `If you have any questions, email support@kloner.app.\n\n` +
          `— The Kloner team`;

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
            {
              error:
                result.error.message ||
                "Email send failed",
            },
            { status: 502 }
          );
        }

        return NextResponse.json(
          { ok: true, id: result.data?.id ?? null },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (err: any) {
        console.error("send-welcome-email failed:", err);
        const msg =
          typeof err?.message === "string"
            ? err.message
            : "Internal error";
        const status = /env not set|RESEND_API_KEY|WELCOME_EMAIL_FROM/i.test(
          msg
        )
          ? 500
          : 400;
        return NextResponse.json(
          { error: msg },
          { status, headers: { "Cache-Control": "no-store" } }
        );
      }
    },
    { methods: ["POST"], csrf: false }
  );
}
