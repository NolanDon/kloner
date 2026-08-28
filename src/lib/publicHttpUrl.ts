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
  "police",
  "wealth",
];
const GOVERNMENT_HOST_SUFFIXES = [
  ".gov", ".gouv", ".mil", ".gov.uk", ".gov.au", ".gov.ca", ".gc.ca",
  ".gov.in", ".govt.nz", ".go.jp", ".go.kr", ".go.id", ".go.th",
  ".gob.mx", ".gob.es", ".gob.ar", ".gob.cl", ".gob.pe", ".gouv.fr",
  ".gouv.qc.ca",
];
const SENSITIVE_FINANCIAL_BRANDS = new Set([
  "anz", "barclays", "bmo", "bnz", "capitalone", "chase", "cibc", "citi",
  "commbank", "dbs", "deutschebank", "halifax", "hdfc", "hsbc", "ing",
  "jpmorgan", "lloyds", "macquarie", "maybank", "nab", "natwest", "paypal",
  "rbc", "revolut", "santander", "scotiabank", "tdbank", "ubs", "usbank",
  "wellsfargo", "westpac", "wise",
]);
const SUSPICIOUS_HOST_LABEL_PREFIXES = ["www-", "xn--"];

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keep this list data-first so additions/removals are easy to review.
export const BLOCKED_URL_TERMS = [
  // Sexual / explicit adult terms
  "18+",
  "adult",
  "adultchat",
  "adultdating",
  "adulthub",
  "adultlive",
  "adultsite",
  "amateurporn",
  "anal",
  "animeporn",
  "asshole",
  "bareback",
  "bdsm",
  "bestiality",
  "bigboobs",
  "bigcock",
  "bikinihottest",
  "bimbos",
  "blowjob",
  "blowjobs",
  "boob",
  "boobs",
  "bootycall",
  "brothel",
  "bukkake",
  "cam2cam",
  "camboy",
  "camboys",
  "camgirl",
  "camgirls",
  "camshow",
  "camshows",
  "camsex",
  "camsite",
  "camsoda",
  "camster",
  "camwhores",
  "cfnm",
  "chaturbate",
  "clit",
  "cock",
  "cocks",
  "creampie",
  "cum",
  "cumshot",
  "cumshots",
  "cunnilingus",
  "deepthroat",
  "dick",
  "dicks",
  "dildo",
  "dildos",
  "dirtyroulette",
  "doggystyle",
  "dominatrix",
  "dp",
  "erotica",
  "erotic",
  "escort",
  "escorts",
  "facesitting",
  "fakeagent",
  "fap",
  "fetish",
  "fisting",
  "footfetish",
  "freesex",
  "gangbang",
  "gangbangs",
  "gayporn",
  "groupsex",
  "handjob",
  "handjobs",
  "hardcore",
  "hentai",
  "hentaigif",
  "hentaiporn",
  "hookupsex",
  "horny",
  "hotgirls",
  "incest",
  "jackoff",
  "jizz",
  "kink",
  "kinky",
  "lesbianporn",
  "livecams",
  "lolita",
  "masturbat",
  "milf",
  "milfs",
  "naked",
  "nudes",
  "nudity",
  "nsfw",
  "onlyfans",
  "onlyfan",
  "orgasm",
  "orgy",
  "p0rn",
  "paizuri",
  "pegging",
  "penis",
  "phub",
  "playboy",
  "porn",
  "pornhub",
  "pornsite",
  "pornstar",
  "pornstars",
  "pornvideo",
  "pornvideos",
  "povsex",
  "publicsex",
  "pussy",
  "redtube",
  "rimming",
  "rule34",
  "s3x",
  "secam",
  "seduce",
  "semen",
  "sex",
  "sexcam",
  "sexcams",
  "sexchat",
  "sexchats",
  "sexclub",
  "sexdating",
  "sexfriend",
  "sexfriends",
  "sexgif",
  "sexhot",
  "sexhub",
  "sexlive",
  "sexmovies",
  "sexparty",
  "sexsite",
  "sexshop",
  "sextape",
  "sexting",
  "sextoy",
  "sextoys",
  "sexual",
  "shemale",
  "siterip",
  "slut",
  "sluts",
  "smut",
  "spank",
  "spanking",
  "squirt",
  "strapon",
  "stripchat",
  "stripclub",
  "stripper",
  "swinger",
  "swingers",
  "taboo",
  "teencam",
  "threesome",
  "tit",
  "tits",
  "titty",
  "tube8",
  "upskirt",
  "voyeur",
  "webcamsex",
  "wetpussy",
  "whore",
  "whores",
  "xhamster",
  "xnxx",
  "xnxxporn",
  "xrated",
  "xvideo",
  "xvideos",
  "xxx",
  "youjizz",
  "youporn",

  // Dangerous / illegal / abuse-enabling terms
  "botnet",
  "carding",
  "cashout",
  "ccdump",
  "clonercard",
  "counterfeit",
  "creditcardfraud",
  "credentialstuffing",
  "crypto drainer",
  "cocaine",
  "crack cocaine",
  "darkweb",
  "ddos",
  "deepfake",
  "dox",
  "doxing",
  "explosive",
  "explosives",
  "fentanyl",
  "firearm",
  "firearms",
  "fraudkit",
  "gamble",
  "gambling",
  "gunstore",
  "hacker",
  "hackers",
  "hacking",
  "hacktool",
  "hacktools",
  "heroin",
  "how to make bomb",
  "howtomakebomb",
  "keylogger",
  "ketamine",
  "launder",
  "laundering",
  "malware",
  "meth",
  "methamphetamine",
  "money mule",
  "money laundering",
  "opiate",
  "opiates",
  "opioid",
  "opioids",
  "phish",
  "phishing",
  "police",
  "ransomware",
  "ransom",
  "skimmer",
  "slot",
  "slots",
  "spoofing",
  "stolencc",
  "stresser",
  "swatting",
  "trojan",
  "weapon",
  "weapons",
  "wire fraud",
  "wirefraud",
  "zero day",
  "zeroday",
] as const;

const BLOCKED_URL_TERM_RE = new RegExp(
  `(?:^|[^a-z0-9])(${BLOCKED_URL_TERMS.map((term) => escapeRegexLiteral(term)).join("|")})(?:[^a-z0-9]|$)`,
  "i",
);

function buildUrlTextForScreening(parsed: URL): string {
  const hostname = parsed.hostname.toLowerCase();
  const decodeSafe = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  const pathname = decodeSafe(parsed.pathname).toLowerCase();
  const search = decodeSafe(parsed.search).toLowerCase();
  const hash = decodeSafe(parsed.hash).toLowerCase();
  return [hostname, pathname, search, hash].filter(Boolean).join(" ");
}

function getSensitiveUrlTermRejectionReason(parsed: URL): string | null {
  const text = buildUrlTextForScreening(parsed);
  if (!text) return null;

  if (BLOCKED_URL_TERM_RE.test(text)) {
    return "This URL is blocked.";
  }

  return null;
}

function getSuspiciousHostLabelRejectionReason(hostLower: string): string | null {
  const labels = hostLower.split(".").filter(Boolean);
  if (!labels.length) return null;

  if (labels.some((label) => SUSPICIOUS_HOST_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix)))) {
    return "This domain is blocked from cloning.";
  }

  return null;
}

function isSensitiveGovernmentHost(hostLower: string): boolean {
  if (GOVERNMENT_HOST_SUFFIXES.some((suffix) =>
    hostLower === suffix.slice(1) || hostLower.endsWith(suffix),
  )) return true;

  // Cover international variants such as .gob.xx, .govt.xx, and go.xx
  // without treating ordinary domains like go.com as government sites.
  return /\.(?:gov|gouv|gob|govt|government|administration|mil)\.[a-z]{2,3}$/i.test(hostLower) ||
    /\.go\.[a-z]{2}$/i.test(hostLower);
}

function isSensitiveFinancialHost(labels: string[]): boolean {
  return labels.some((label) => {
    const compact = label.replace(/[^a-z0-9]/g, "");
    return SENSITIVE_FINANCIAL_BRANDS.has(compact);
  });
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
      return "This domain is blocked from cloning.";
    }

    if (!DOMAIN_RE.test(hostLower)) return "Please enter a valid public http(s) URL.";

    if (isSensitiveGovernmentHost(hostLower)) {
      return "Banking, government, and account-access URLs are blocked.";
    }

    const suspiciousHostReason = getSuspiciousHostLabelRejectionReason(hostLower);
    if (suspiciousHostReason) {
      return suspiciousHostReason;
    }

    const labels = hostLower.split(".").filter(Boolean);
    if (labels.some((label) => SENSITIVE_HOST_LABELS.has(label))) {
      return "Banking, government, and account-access URLs are blocked.";
    }

    if (SENSITIVE_HOST_FRAGMENTS.some((fragment) => hostLower.includes(fragment))) {
      return "Banking, government, and account-access URLs are blocked.";
    }

    if (isSensitiveFinancialHost(labels)) {
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
