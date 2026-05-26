import type { Metadata } from "next";
import AdminUsersClient from "./AdminUsersClient";

export const metadata: Metadata = {
    title: "Admin · Users",
    description: "Admin view for browsing and deleting user accounts.",
};

export default function AdminUsersPage() {
    return (
        <main className="min-h-screen bg-white pt-8 text-black">
            <section className="mx-auto max-w-7xl bg-white px-4 sm:px-6 lg:px-8 text-black">
                <div className="pb-20">
                    <AdminUsersClient />
                </div>
            </section>
        </main>
    );
}