// app/contact/page.tsx
import type { Metadata } from "next";
import ContactClient from "./ContactClient";

export const metadata: Metadata = {
    title: "Contact",
    description:
        "Contact Kloner for support, partnerships, or product questions. Get help cloning, customizing, and deploying faster with an AI agent.",
    alternates: { canonical: "https://kloner.app/contact" },
    openGraph: { url: "https://kloner.app/contact" },
};

export default function ContactPage() {
    return <ContactClient />;
}
