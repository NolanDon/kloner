import { validateAndNormalizePublicHttpUrl } from "./publicHttpUrl";

export function scanSourceMatchesUrl(source: { url?: unknown } | null | undefined, target: string): boolean {
    const expected = validateAndNormalizePublicHttpUrl(target);
    const actual = validateAndNormalizePublicHttpUrl(String(source?.url || ""));
    if (!expected || !actual) return false;
    const key = (value: string) => {
        const url = new URL(value);
        url.hash = "";
        return url.href;
    };
    return key(expected) === key(actual);
}
