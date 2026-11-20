import type { Metadata } from "next";
import SupportInboxClient from "./SupportInboxClient";

export const metadata: Metadata = {
    title: "Admin · Support inbox",
    description: "Read and reply to support@kloner.app email.",
};

export default function SupportInboxPage() {
    return (
        <main className="min-h-screen bg-white pt-8 text-black">
            <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
                <SupportInboxClient />
            </section>
        </main>
    );
}
