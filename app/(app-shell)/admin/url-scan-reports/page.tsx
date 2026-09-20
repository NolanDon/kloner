import type { Metadata } from "next";
import AdminUrlScanReportsClient from "./AdminUrlScanReportsClient";

export const metadata: Metadata = {
    title: "Admin · URL scan reports",
    description: "Daily URL scan outcomes and diagnostics.",
};

export default function AdminUrlScanReportsPage() {
    return (
        <main className="pt-8 min-h-screen bg-white text-black">
            <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <AdminUrlScanReportsClient />
            </section>
        </main>
    );
}
