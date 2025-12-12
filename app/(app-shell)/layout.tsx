// app/(app-shell)/layout.tsx
"use client";

import type { ReactNode } from "react";
import AppShellLayout from "../dashboard/layout"; // or move the code into a shared component

export default function AppShellGroupLayout({ children }: { children: ReactNode }) {
    return <AppShellLayout>{children}</AppShellLayout>;
}
