type RecoveryOfferEmailVariant = "checkout" | "winback";

type RecoveryOfferEmailArgs = {
    name?: string | null;
    linkUrl: string;
    unsubUrl: string;
    variant: RecoveryOfferEmailVariant;
};

function safeName(name?: string | null): string {
    return (name || "there").trim() || "there";
}

function subjectForVariant(variant: RecoveryOfferEmailVariant): string {
    return variant === "winback" ? "Still want to build this?" : "A quick note about your checkout";
}

function introForVariant(variant: RecoveryOfferEmailVariant, name: string): string {
    if (variant === "winback") {
        return `Hey ${name}, I noticed you signed up but haven’t had much of a chance to dig in yet.`;
    }

    return `Hey ${name}, I saw you were close to finishing up.`;
}

function bodyForVariant(variant: RecoveryOfferEmailVariant): string {
    if (variant === "winback") {
        return "If you want to come back and give Kloner a proper look, I saved 40% off your first month for you.";
    }

    return "If price was the sticking point, I saved 40% off your first month for you.";
}

export function buildRecoveryOfferEmail(args: RecoveryOfferEmailArgs) {
    const ACCENT = "#FF8D21";
    const ACCENT_DARK = "#D96E11";
    const ACCENT_SOFT = "#FFF4EA";
    const TEXT = "#111827";
    const MUTED = "#6b7280";

    const name = safeName(args.name);
    const subject = subjectForVariant(args.variant);
    const intro = introForVariant(args.variant, name);
    const body = bodyForVariant(args.variant);

    const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
            <td align="center" style="padding:40px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;border:1px solid #fde4d2;border-radius:20px;overflow:hidden;">
                    <tr>
                        <td style="padding:16px 24px;background:linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DARK} 100%);color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">
                            Kloner
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px 24px 28px 24px;background:#ffffff;font-size:15px;line-height:1.7;">
                            <p style="margin:0 0 16px 0;color:${TEXT};">${intro}</p>
                            <p style="margin:0 0 16px 0;color:${TEXT};">${body}</p>
                            <p style="margin:0 0 24px 0;">
                                <a href="${args.linkUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:700;box-shadow:0 10px 24px rgba(255,141,33,0.22);">Claim 40% off</a>
                            </p>
                            <p style="margin:0 0 16px 0;padding:12px 14px;border-radius:14px;background:${ACCENT_SOFT};border:1px solid #f9d2b4;color:${TEXT};font-size:13px;">
                                No pressure if now isn’t the right time. <a href="${args.unsubUrl}" style="color:${ACCENT_DARK};text-decoration:underline;font-weight:600;">Unsubscribe from these emails</a>.
                            </p>
                            <p style="margin:0 0 4px 0;color:${MUTED};font-size:13px;">— Nolan</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    const text = `${intro}\n\n${body}\n\nClaim 40% off:\n${args.linkUrl}\n\nNo pressure if now isn’t the right time. Unsubscribe from these emails:\n${args.unsubUrl}\n\n— Nolan`;

    return { subject, html, text };
}
