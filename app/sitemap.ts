import type { MetadataRoute } from "next";
import { getAllBlogPosts, getBlogIndexUrl, getBlogPostUrl, getSiteUrl } from "@/lib/blog";
import { TOOL_CONFIGS } from "@/components/tools/toolRegistry";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${site}/`, lastModified: now, priority: 1.0 },
    { url: `${site}/tools`, lastModified: now, priority: 0.9 },
    { url: `${site}/price`, lastModified: now, priority: 0.8 },
    { url: `${site}/community-builds`, lastModified: now, priority: 0.8 },
    { url: `${site}/compare`, lastModified: now, priority: 0.6 },
    { url: `${site}/contact`, lastModified: now, priority: 0.6 },
    { url: `${site}/partners`, lastModified: now, priority: 0.5 },
    { url: `${site}/terms`, lastModified: now, priority: 0.5 },
    { url: `${site}/legal/kloner-vercel-eula`, lastModified: now, priority: 0.5 },
    { url: getBlogIndexUrl(), lastModified: now, priority: 0.7 },
    { url: `${site}/blog/rss.xml`, lastModified: now, priority: 0.3 },
  ];

  const blogRoutes: MetadataRoute.Sitemap = getAllBlogPosts().map((p) => ({
    url: getBlogPostUrl(p.slug),
    lastModified: new Date(p.updatedAt || p.publishedAt),
    priority: 0.7,
  }));

  const toolRoutes: MetadataRoute.Sitemap = TOOL_CONFIGS.map((tool) => ({
    url: `${site}/tools/${tool.slug}`,
    lastModified: now,
    priority: 0.8,
  }));

  return [...staticRoutes, ...toolRoutes, ...blogRoutes];
}
