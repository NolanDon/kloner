// app/dashboard/view/page.tsx (SERVER)
import type { Metadata } from "next";
import DashboardView from "./DashboardView";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
};

export default function Page() {
  return <DashboardView />;
}
