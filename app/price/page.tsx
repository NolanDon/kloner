// app/price/page.tsx (SERVER)
import type { Metadata } from "next";
import PriceClient from "./PriceClient";

export const metadata: Metadata = {
    title: "Pricing – Kloner Website Cloner & Builder",
    description:
        "View Kloner pricing for cloning websites, copying landing pages, and building sites with AI. Compare plans for website cloning, HTML export, editing, and one-click deployment to Vercel.",
    alternates: {
        canonical: "https://kloner.app/price",
    },
};

export default function Page() {
    return <PriceClient />;
}
