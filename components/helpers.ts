export function sanitizeName(raw: string): string {
    if (!raw) return "";

    let out = raw.toLowerCase().trim();

    // strip protocol
    out = out.replace(/^https?:\/\//, "");

    // strip www.
    out = out.replace(/^www\./, "");

    // strip trailing slash
    out = out.replace(/\/+$/, "");

    // strip common TLDs explicitly (now includes .ca) when they appear as the
    // domain ending (before a slash or end-of-string)
    out = out.replace(
        /\.(com|net|org|io|app|dev|site|co|ai|info|xyz|me|ca)(?=\/|$)/g,
        ""
    );

    // generic safety net: strip any remaining ".xxxx" that looks like a TLD
    // (2–10 letters) when it's at the end of the host portion
    out = out.replace(/\.[a-z]{2,10}(?=\/|$)/g, "");

    // remove query strings or fragments
    out = out.replace(/[\?#].*$/, "");

    // collapse any leftover slashes to spaces
    out = out.replace(/[\/]+/g, " ");

    // trim spaces
    out = out.trim();

    // capitalize first letter for aesthetics
    if (out.length > 1) {
        out = out[0].toUpperCase() + out.slice(1);
    }

    return out || "Untitled";
}

export function sanitizeImageName(name: string) {
    const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    return base.slice(-64) || "image";
}
