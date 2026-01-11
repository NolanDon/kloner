// app/contact/page.tsx
import type { Metadata } from "next";
import ContactClient from "./ContactClient";

export const metadata: Metadata = {
    title: "Contact | Kloner",
    description: "Contact Kloner for support, partnerships, or questions.",
    alternates: { canonical: "https://kloner.app/contact" },
    openGraph: { url: "https://kloner.app/contact" },
};

export default function ContactPage() {
    return <ContactClient />;
}
