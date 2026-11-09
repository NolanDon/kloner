import type { Metadata } from "next";
import AbuseBlocklistClient from "./AbuseBlocklistClient";

export const metadata: Metadata = {
    title: "Admin · Abuse blocklist",
    description: "Manage Stripe checkout abuse block rules.",
};

export default function AbuseBlocklistPage() {
    return (
        <main className="min-h-screen bg-white pt-8 text-black">
            <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 lg:px-8">
                <AbuseBlocklistClient />
            </section>
        </main>
    );
}
