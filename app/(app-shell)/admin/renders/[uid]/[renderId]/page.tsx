// src/app/admin/renders/[uid]/[renderId]/page.tsx
import type { Metadata } from "next";
import AdminRenderPreviewClient from "./AdminRenderPreviewClient";

export const metadata: Metadata = {
    title: "Admin · Render preview",
    description: "Admin preview for a user render.",
};

export default function AdminRenderPreviewPage({
    params,
}: {
    params: { uid: string; renderId: string };
}) {
    return (
        <main className="pt-6 min-h-screen bg-white text-black">
            <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
                <AdminRenderPreviewClient uid={params.uid} renderId={params.renderId} />
            </section>
        </main>
    );
}
