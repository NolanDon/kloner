import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "AI Website Cloner | Clone Any Website Online | Kloner",
  description:
    "Use Kloner as an AI website cloner: clone a website from a URL, preview and edit the result, then deploy your finished website online.",
  alternates: {
    canonical: "https://kloner.app/",
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
