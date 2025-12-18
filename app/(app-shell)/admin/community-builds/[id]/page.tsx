// src/app/admin/community-builds/[id]/page.tsx
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import AdminCommunityBuildPreviewClient from "./AdminCommunityBuildViewerClient";

export const metadata: Metadata = {
    title: "Admin preview | Community build",
    description: "Admin-only preview + moderation for gallery builds.",
};

export default function AdminCommunityBuildPreviewPage({
    params,
}: {
    params: { id: string };
}) {
    return (
        <main className="min-h-screen bg-white text-black">
            <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-10 pb-16">
                <AdminCommunityBuildPreviewClient id={params.id} />
            </section>
        </main>
    );
}
