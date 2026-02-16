import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "Kloner – Website Cloner & Builder",
  description:
<<<<<<< HEAD
    "Clone, customize, and deploy high‑fidelity website layouts. Drop a link or enter a description to generate an editable preview, export clean HTML, and ship faster.",
=======
    "Website cloner to clone, customize, and deploy high‑fidelity layouts. Paste a URL to generate an editable preview, export clean HTML, and ship faster.",
>>>>>>> 1357eefcc72274d4d085785f3f3690f011babeae
  alternates: {
    canonical: "https://kloner.app/",
  },
};

export default function Page() {
  return <HomeClient />;
}
