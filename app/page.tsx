import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "Kloner – Website Cloner & Builder",
  description:
    "Clone, customize, and deploy high‑fidelity website layouts. Drop a link or enter a description to generate an editable preview, export clean HTML, and ship faster.",
  alternates: {
    canonical: "https://kloner.app/",
  },
};

export default function Page() {
  return <HomeClient />;
}
