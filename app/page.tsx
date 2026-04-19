import type { Metadata } from "next";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  title: "Clone Website Fast | Website Cloner & Website Copier | Kloner",
  description:
    "Clone a website instantly with Kloner, a website cloner and website copier online that helps you copy a website, customize the layout, and launch fast.",
  alternates: {
    canonical: "https://kloner.app/",
  },
};

export default function Page() {
  return <HomeClient />;
}
