import { getAllBlogPosts, getBlogIndexUrl, getBlogPostUrl, getSiteUrl } from "@/lib/blog";

export const runtime = "nodejs";

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const posts = getAllBlogPosts();
  const now = new Date().toUTCString();

  const items = posts
    .map((p) => {
      const url = getBlogPostUrl(p.slug);
      return `\n    <item>\n      <title>${escapeXml(p.title)}</title>\n      <link>${escapeXml(url)}</link>\n      <guid isPermaLink="true">${escapeXml(url)}</guid>\n      <description>${escapeXml(p.description)}</description>\n      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>\n    </item>`;
    })
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Kloner Blog</title>
    <link>${escapeXml(getBlogIndexUrl())}</link>
    <description>${escapeXml(
      "Articles on AI app cloning, website cloning, MVP testing, and AI agents.",
    )}</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>${escapeXml(getSiteUrl())}</generator>${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=600",
    },
  });
}
