// src/app/admin/renders/page.tsx
import type { Metadata } from "next";
import AdminRendersClient from "./AdminRendersClient";

export const metadata: Metadata = {
    title: "Admin · User renders",
    description: "Admin view for browsing all user renders.",
};

export default function AdminUserRendersPage() {
    return (
        <main className="pt-8 min-h-screen bg-white text-black">
            <section className="bg-white text-black mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
                <div className="pb-20">
                    <AdminRendersClient />
                </div>
            </section>
        </main>
    );
}
