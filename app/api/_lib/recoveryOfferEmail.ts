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
    return variant === "winback" ? "Still want to build this?" : "Still want 40% off?";
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
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
            <td align="center" style="padding:40px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
                    <tr>
                        <td style="font-size:15px;line-height:1.7;">
                            <p style="margin:0 0 16px 0;">${intro}</p>
                            <p style="margin:0 0 16px 0;">${body}</p>
                            <p style="margin:0 0 24px 0;">
                                <a href="${args.linkUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">Claim 40% off</a>
                            </p>
                            <p style="margin:0 0 16px 0;color:#6b7280;font-size:13px;">No pressure if now isn’t the right time. <a href="${args.unsubUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe from these emails</a>.</p>
                            <p style="margin:0 0 24px 0;color:#374151;">— Nolan</p>
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
