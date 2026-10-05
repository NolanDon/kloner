import type { MetadataRoute } from "next";
import { getAllBlogPosts, getBlogIndexUrl, getBlogPostUrl, getSiteUrl } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${site}/`, priority: 1.0 },
    { url: `${site}/price`, priority: 0.8 },
    { url: `${site}/community-builds`, priority: 0.8 },
    { url: `${site}/compare`, priority: 0.6 },
    { url: `${site}/contact`, priority: 0.6 },
    { url: `${site}/partners`, priority: 0.5 },
    { url: `${site}/privacy`, priority: 0.5 },
    { url: `${site}/terms`, priority: 0.5 },
    { url: `${site}/legal/kloner-vercel-eula`, priority: 0.5 },
    { url: getBlogIndexUrl(), priority: 0.7 },
  ];

  const blogRoutes: MetadataRoute.Sitemap = getAllBlogPosts().map((p) => ({
    url: getBlogPostUrl(p.slug),
    lastModified: new Date(p.updatedAt || p.publishedAt),
    priority: 0.7,
  }));

  return [...staticRoutes, ...blogRoutes];
}
