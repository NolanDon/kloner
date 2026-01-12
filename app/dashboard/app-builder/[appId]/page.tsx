// app/dashboard/app-builder/[appId]/page.tsx
import { Metadata } from "next";
import AppBuilderEditor from "@/components/AppBuilderEditor";

export const metadata: Metadata = {
    title: "App Builder",
};

export default function AppBuilderPage({ params }: { params: { appId: string } }) {
    return <AppBuilderEditor appId={params.appId} />;
}