/** The page template owns the article H1; remove a leading Markdown H1 only. */
export function stripLeadingMarkdownTitle(markdown: string): string {
  const lines = String(markdown || "").split("\n");
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first === -1 || !/^#\s+/.test(lines[first]!.trim())) return markdown;
  return [...lines.slice(0, first), ...lines.slice(first + 1)].join("\n").replace(/^\s*\n/, "");
}
