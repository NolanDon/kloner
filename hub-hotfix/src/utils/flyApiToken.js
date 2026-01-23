// src/utils/flyApiToken.js

export function getFlyApiToken(rawEnvValue) {
    const effectiveRaw =
        rawEnvValue ??
        process.env.FLY_API_TOKEN ??
        process.env.FLY_API_KEY ??
        process.env.FLY_TOKEN ??
        '';

    const raw = String(effectiveRaw || '').trim();
    if (!raw) return '';

    // IMPORTANT:
    // FlyV1 tokens include a comma-separated third-party discharge token.
    // Do NOT split on commas, or you will truncate the token and Fly Machines
    // will reject it (e.g. "missing third-party discharge token").
    if (raw.startsWith('FlyV1 ')) {
        return raw;
    }

    // Fly tokens (e.g. fm2_..., fo1_...) do not contain commas.
    // Some environments accidentally concatenate multiple tokens with commas/newlines.
    const parts = raw
        .split(/[\n\r,]+/)
        .map((p) => String(p || '').trim())
        .filter(Boolean);

    if (!parts.length) return '';

    // Prefer machine tokens if multiple are present.
    const preferred = parts.find((p) => /^fm\d_/.test(p)) || parts.find((p) => /^fo\d_/.test(p));
    return preferred || parts[0];
}

export function summarizeFlyToken(rawEnvValue) {
    const raw = String(rawEnvValue || '').trim();
    const token = getFlyApiToken(rawEnvValue);
    if (!token) return { present: false };
    const isFlyV1 = token.startsWith('FlyV1 ');
    return {
        present: true,
        prefix: token.slice(0, 4),
        length: token.length,
        // For FlyV1 tokens, commas are expected (macaroon,discharge). Only treat newlines as multi.
        multi: isFlyV1 ? /[\n\r]/.test(raw) : raw.includes(',') || /[\n\r]/.test(raw),
    };
}
