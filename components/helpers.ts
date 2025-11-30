
export function sanitizeName(raw: string): string {
    if (!raw) return "";

    let out = raw.toLowerCase().trim();

    // strip protocol
    out = out.replace(/^https?:\/\//, "");

    // strip trailing slash
    out = out.replace(/\/+$/, "");

    // strip www.
    out = out.replace(/^www\./, "");

    // strip TLDs (.com, .net, .io, .app, etc.)
    out = out.replace(/\.(com|net|org|io|app|dev|site|co|ai|info|xyz|me)(\/|$)/, "");

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


