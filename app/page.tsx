import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "AI Website Cloner | Clone a Website from a URL | Kloner",
  description:
    "Clone a website from a public URL with Kloner's AI website cloner. Create an editable preview, customize it with AI, and start with limited free access.",
  alternates: {
    canonical: "https://kloner.app/",
  },
  openGraph: {
    title: "AI Website Cloner | Clone a Website from a URL | Kloner",
    description:
      "Clone a website from a public URL with Kloner's AI website cloner. Create an editable preview, customize it with AI, and start with limited free access.",
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
    title: "AI Website Cloner | Clone a Website from a URL | Kloner",
    description:
      "Clone a website from a public URL with Kloner's AI website cloner. Create an editable preview, customize it with AI, and start with limited free access.",
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
