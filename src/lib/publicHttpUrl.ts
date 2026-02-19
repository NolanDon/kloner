// Shared URL validation for user-provided URLs (landing hero, overlays, dashboard mini entry).
// Goal: accept only public http(s) URLs with a real domain; reject localhost/private IPs and obvious garbage.

function toAbsolute(u: string) {
  const s = u.trim();
  if (!s) return "";
  try {
    return new URL(s).toString();
  } catch {
    try {
      return new URL(`https://${s}`).toString();
    } catch {
      return "";
    }
  }
}

export function stripProtocol(input: string) {
  return input.replace(/^\s*https?:\/\//i, "").trim();
}

const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

// Returns a normalized absolute URL string (https://...) or null.
export function validateAndNormalizePublicHttpUrl(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (s.length > 2083) return null;

  const lower = s.toLowerCase();
  if (lower === "http" || lower === "https") return null;

  // Disallow whitespace/control characters anywhere.
  if (/\s/.test(s)) return null;
  if (/[\u0000-\u001F\u007F]/.test(s)) return null;

  const abs = toAbsolute(s);
  if (!abs) return null;

  try {
    const parsed = new URL(abs);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return null;

    const hostLower = parsed.hostname.toLowerCase();

    // Block local / private networks.
    if (
      hostLower === "localhost" ||
      hostLower === "::1" ||
      hostLower === "0.0.0.0" ||
      /^127(?:\.\d{1,3}){0,3}$/.test(hostLower) ||
      /^10\./.test(hostLower) ||
      /^192\.168\./.test(hostLower) ||
      /^169\.254\./.test(hostLower) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostLower)
    ) {
      return null;
    }

    // Must look like a real domain (has a TLD).
    if (!DOMAIN_RE.test(hostLower)) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}
