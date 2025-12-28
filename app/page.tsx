import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "Kloner – AI Website Cloner & Builder",
  description:
    "Kloner is an AI-powered website cloner and builder that lets you copy existing websites, clone landing pages, and turn them into fully editable, deployable HTML sites. Clone any website layout, rewrite content, customize design, and publish instantly.",
  alternates: {
    canonical: "https://kloner.app/",
  },
};

export default function Page() {
  return <HomeClient />;
}
