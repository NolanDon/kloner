// src/app/admin/community-builds/page.tsx
import type { Metadata } from "next";
import AdminCommunityBuildsClient from "./AdminCommunityBuildsClient";

export const metadata: Metadata = {
    title: "Admin · Community builds",
    description: "Admin queue for approving community builds.",
};

export default function AdminCommunityBuildsPage() {
    return (
        <main className="pt-8 min-h-screen bg-white text-black">
            <section className="bg-white text-black mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
                <div className="pb-20">
                    <AdminCommunityBuildsClient />
                </div>
            </section>
        </main>
    );
}
