import type { Metadata } from 'next';
import WebsiteClonerClient from './WebsiteClonerClient';
import { WEBSITE_CLONER_FAQ } from '@/lib/websiteClonerFaq';

const title = 'AI Website Cloner — Clone Any Website from a URL';
const description = 'Kloner is the AI website cloner that turns any public URL into an editable website. Paste a link, preview instantly, customize, deploy. Start free, no setup.';
const url = 'https://kloner.app/website-cloner';

export const metadata: Metadata = {
  title, description, alternates: { canonical: url },
  openGraph: { title, description, url, siteName: 'Kloner', type: 'website', images: [{ url: '/images/opengraph.jpg', width: 1200, height: 630, alt: 'Kloner website cloner' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/images/opengraph.jpg'] },
  robots: { index: true, follow: true },
};

export default function WebsiteClonerPage() {
  const jsonLd = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': url + '#webpage', url, name: title, description, breadcrumb: { '@id': url + '#breadcrumb' } },
    { '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://kloner.app/' }, { '@type': 'ListItem', position: 2, name: 'Website Cloner', item: url }] },
    { '@type': 'SoftwareApplication', name: 'Kloner', applicationCategory: 'DeveloperApplication', operatingSystem: 'Web', description, url },
    { '@type': 'FAQPage', mainEntity: WEBSITE_CLONER_FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /><WebsiteClonerClient /></>;
}
