const DEFAULT_FILLERS = [
  "Kloner keeps the workflow editable, fast, and easy to ship.",
  "Use Kloner to preview, edit, and launch the result faster.",
  "Built for quick, browser-based workflows in Kloner.",
  "Designed for clear previews and launch-ready results.",
];

function normalizeWhitespace(text: string | null | undefined): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function clipAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength).trimEnd();
  const lastSpace = clipped.lastIndexOf(" ");

  if (lastSpace > 0) {
    return clipped.slice(0, lastSpace).trimEnd();
  }

  return clipped;
}

export function buildMetaDescription(
  parts: Array<string | undefined | null>,
  options: {
    minLength?: number;
    maxLength?: number;
    targetLength?: number;
    fillers?: string[];
  } = {},
): string {
  const minLength = options.minLength ?? 150;
  const maxLength = options.maxLength ?? 160;
  const targetLength = options.targetLength ?? 155;
  const fillers = options.fillers ?? DEFAULT_FILLERS;

  const normalizedParts = parts
    .map(normalizeWhitespace)
    .filter((part): part is string => part.length > 0);
  if (!normalizedParts.length) return "";

  let text = normalizedParts.join(" ");

  if (text.length >= minLength && text.length <= maxLength) {
    return text;
  }

  if (text.length < minLength) {
    for (const filler of fillers) {
      const candidate = normalizeWhitespace(`${text} ${filler}`);
      if (candidate.length >= minLength && candidate.length <= maxLength) {
        return candidate;
      }
      text = candidate;
    }
  }

  if (text.length > maxLength) {
    const targetClipped = clipAtWordBoundary(text, targetLength);
    if (targetClipped.length >= minLength) {
      return targetClipped;
    }

    const maxClipped = clipAtWordBoundary(text, maxLength);
    if (maxClipped.length >= minLength) {
      return maxClipped;
    }

    return text.slice(0, maxLength).trimEnd();
  }

  if (text.length < minLength) {
    const finalCandidate = normalizeWhitespace(`${text} ${fillers[0]}`);
    if (finalCandidate.length <= maxLength) {
      return finalCandidate;
    }

    const clipped = clipAtWordBoundary(finalCandidate, targetLength);
    if (clipped.length >= minLength) {
      return clipped;
    }

    return finalCandidate.slice(0, maxLength).trimEnd();
  }

  return text;
}
