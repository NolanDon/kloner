import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "Kloner – Website Cloner & Builder",
  description:
    "Website cloner to clone, customize, and deploy high‑fidelity layouts. Paste a URL to generate an editable preview, export clean HTML, and ship faster.",
  alternates: {
    canonical: "https://kloner.app/",
  },
};

export default function Page() {
  return <HomeClient />;
}
