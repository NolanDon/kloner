import type { Metadata } from "next";
import HomeClient from "./HomeClient";
import { WEBSITE_CLONER_FAQ } from "@/lib/websiteClonerFaq";

export const metadata: Metadata = {
  title: { absolute: "Website Cloner — Clone a Website from a URL | Kloner" },
  description:
    "Kloner is an AI website cloner that turns a public URL into an editable website preview. Customize the layout, text, and images, then deploy your site.",
  alternates: {
    canonical: "https://kloner.app/",
  },
  openGraph: {
    title: "Website Cloner — Clone a Website from a URL | Kloner",
    description:
      "Kloner is an AI website cloner that turns a public URL into an editable website preview. Customize the layout, text, and images, then deploy your site.",
    url: "https://kloner.app/",
    siteName: "Kloner",
    type: "website",
    images: [
      {
        url: "/images/opengraph.jpg",
        width: 1200,
        height: 630,
        alt: "Kloner AI website cloner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Website Cloner — Clone a Website from a URL | Kloner",
    description:
      "Kloner is an AI website cloner that turns a public URL into an editable website preview. Customize the layout, text, and images, then deploy your site.",
    images: ["/images/opengraph.jpg"],
  },
};

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://kloner.app/#organization",
        name: "Kloner",
        url: "https://kloner.app/",
        logo: "https://kloner.app/images/orange_logo.png",
      },
      {
        "@type": "WebSite",
        "@id": "https://kloner.app/#website",
        name: "Kloner",
        url: "https://kloner.app/",
        publisher: { "@id": "https://kloner.app/#organization" },
      },
      {
        "@type": "FAQPage",
        mainEntity: WEBSITE_CLONER_FAQ.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
      {
        "@type": "SoftwareApplication",
        name: "Kloner",
        applicationCategory: "WebApplication",
        operatingSystem: "Web",
        description: "AI website cloner for recreating, editing, and deploying websites from public URLs.",
        url: "https://kloner.app/",
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeClient />
    </>
  );
}
