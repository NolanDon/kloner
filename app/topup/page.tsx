import type { Metadata } from "next";
import TopupClient from "./TopupClient";

export const metadata: Metadata = {
    title: "Top up credits – Kloner",
    description: "Buy one-time AI credit top-ups for Kloner with secure Stripe checkout.",
    alternates: {
        canonical: "https://kloner.app/topup",
    },
    openGraph: {
        url: "https://kloner.app/topup",
    },
};

export default function Page() {
    return <TopupClient />;
}

