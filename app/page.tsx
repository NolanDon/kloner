import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "Kloner – AI Website Cloner & Builder",
  description:
    "Clone, customize, and deploy high‑fidelity website layouts. Paste a URL to generate an editable preview, export clean HTML, and ship faster.",
  alternates: {
    canonical: "https://kloner.app",
  },
};

export default function Page() {
  return <HomeClient />;
}
