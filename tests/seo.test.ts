import { getAllBlogPosts, getBlogPostBySlug } from '../lib/blog';
import { stripLeadingMarkdownTitle } from '../lib/blogMarkdown';
import sitemap from '../app/sitemap';

describe('website-focused publishing', () => {
  const retired = ['app-cloner', 'ai-app-cloner', 'how-to-clone-apps', 'website-clone', 'clone-site'];
  it('excludes consolidated content from direct lookup, index and sitemap', () => {
    const posts = getAllBlogPosts();
    const urls = sitemap().map(entry => entry.url);
    for (const slug of retired) {
      expect(getBlogPostBySlug(slug)).toBeNull();
      expect(posts.some(post => post.slug === slug)).toBe(false);
      expect(urls).not.toContain(`https://kloner.app/blog/${slug}`);
    }
    expect(getBlogPostBySlug('clone-web-app-ui')).not.toBeNull();
    expect(getBlogPostBySlug('how-to-clone-a-website')).not.toBeNull();
  });
  it('keeps authored blog links pointing to published content', () => {
    const posts = getAllBlogPosts();
    for (const post of posts) {
      for (const match of post.markdown.matchAll(/\]\((?:https:\/\/kloner\.app)?\/blog\/([^)#?\s]+)[^)]*\)/g)) {
        expect({ source: post.slug, target: match[1], exists: !!getBlogPostBySlug(match[1]!) }).toEqual({ source: post.slug, target: match[1], exists: true });
      }
    }
  });
  it('omits unverified modification dates for static pages', () => {
    expect(sitemap().filter(entry => !entry.url.includes('/blog/')).every(entry => entry.lastModified === undefined)).toBe(true);
  });
});

describe('article Markdown heading handling', () => {
  it('removes a leading H1 even when its wording differs from the page title', () => {
    expect(stripLeadingMarkdownTitle('\n# Alternate title\n\nIntro\n\n## Steps')).toBe('Intro\n\n## Steps');
  });
  it('preserves a leading H2, content and later headings', () => {
    expect(stripLeadingMarkdownTitle('## Steps\nContent')).toBe('## Steps\nContent');
    expect(stripLeadingMarkdownTitle('Intro\n# Later heading')).toBe('Intro\n# Later heading');
    expect(stripLeadingMarkdownTitle('')).toBe('');
  });
});
