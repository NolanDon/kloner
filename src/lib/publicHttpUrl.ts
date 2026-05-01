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
const PRIVATE_HOST_RE =
  /^(?:localhost|::1|0\.0\.0\.0|127(?:\.\d{1,3}){0,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})$/i;
const BLOCKED_HOST_RE = /(^|\.)kloner\.app$/i;
const SENSITIVE_HOST_LABELS = new Set([
  "account",
  "accounts",
  "auth",
  "bank",
  "banks",
  "broker",
  "brokerage",
  "court",
  "courts",
  "credit",
  "defense",
  "federal",
  "finance",
  "financial",
  "gov",
  "government",
  "healthcare",
  "homeland",
  "immigration",
  "invest",
  "investment",
  "irs",
  "justice",
  "loan",
  "loans",
  "login",
  "medicaid",
  "medicare",
  "mil",
  "mortgage",
  "passport",
  "payment",
  "payments",
  "police",
  "secure",
  "signin",
  "sso",
  "state",
  "tax",
  "treasury",
  "visa",
  "wallet",
  "wealth",
]);
const SENSITIVE_HOST_FRAGMENTS = [
  "bank",
  "brokerage",
  "credit",
  "finance",
  "financial",
  "loan",
  "mortgage",
  "wealth",
];
const BLOCKED_URL_TERM_RE = /(?:^|[^a-z0-9])(adult|cam(?:girl|girls|boy|boys)?|casino|cocaine|counterfeit|crypto\s*drainer|deepfake|escort|explosive|fentanyl|firearm|gambl(?:e|ing)|hack(?:ing|er|tool)?|heroin|ketamine|meth(?:amphetamine)?|money\s*launder(?:ing)?|nsfw|onlyfans|opiate|opioid|phish(?:ing)?|porn(?:hub)?|ransomware|sex(?:cam|chat|toy)?|sexual|slot(?:s)?|weapon(?:s)?|xhamster|xvideo(?:s)?|xxx)(?:[^a-z0-9]|$)/i;

function buildUrlTextForScreening(parsed: URL): string {
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();
  const hash = parsed.hash.toLowerCase();
  return [hostname, pathname, search, hash].filter(Boolean).join(" ");
}

function getSensitiveUrlTermRejectionReason(parsed: URL): string | null {
  const text = buildUrlTextForScreening(parsed);
  if (!text) return null;

  if (BLOCKED_URL_TERM_RE.test(text)) {
    return "Sexually explicit, financial-account, and dangerous-use URLs are blocked.";
  }

  return null;
}

export function getPublicHttpUrlRejectionReason(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return "Enter a URL to continue.";
  if (s.length > 2083) return "URL is too long.";

  const lower = s.toLowerCase();
  if (lower === "http" || lower === "https") return "Please enter a valid public http(s) URL.";

  if (/\s/.test(s) || /[\u0000-\u001F\u007F]/.test(s)) {
    return "Please enter a valid public http(s) URL.";
  }

  const abs = toAbsolute(s);
  if (!abs) return "Please enter a valid public http(s) URL.";

  try {
    const parsed = new URL(abs);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return "Please enter a valid public http(s) URL.";

    const hostLower = parsed.hostname.toLowerCase();
    if (!hostLower) return "Please enter a valid public http(s) URL.";

    if (PRIVATE_HOST_RE.test(hostLower)) {
      return "Local and private-network URLs are blocked.";
    }

    if (BLOCKED_HOST_RE.test(hostLower)) {
      return "Kloner domains are blocked from cloning.";
    }

    if (!DOMAIN_RE.test(hostLower)) return "Please enter a valid public http(s) URL.";

    const labels = hostLower.split(".").filter(Boolean);
    if (labels.some((label) => SENSITIVE_HOST_LABELS.has(label))) {
      return "Banking, government, and account-access URLs are blocked.";
    }

    if (SENSITIVE_HOST_FRAGMENTS.some((fragment) => hostLower.includes(fragment))) {
      return "Banking, government, and account-access URLs are blocked.";
    }

    const sensitiveUrlReason = getSensitiveUrlTermRejectionReason(parsed);
    if (sensitiveUrlReason) {
      return sensitiveUrlReason;
    }

    return null;
  } catch {
    return "Please enter a valid public http(s) URL.";
  }
}

// Returns a normalized absolute URL string (https://...) or null.
export function validateAndNormalizePublicHttpUrl(input: string): string | null {
  if (getPublicHttpUrlRejectionReason(input)) return null;

  try {
    const parsed = new URL(toAbsolute(input.trim()));
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return null;

    const hostLower = parsed.hostname.toLowerCase();

    // Must look like a real domain (has a TLD).
    if (!DOMAIN_RE.test(hostLower)) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}
