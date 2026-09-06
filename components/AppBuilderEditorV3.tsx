"use client";

import AppBuilderEditor from "./AppBuilderEditor";
import { useAuth } from "@/src/hooks/useAuth";

const TEST_UID = "FJPVD2BuHrXBLhOFOBWi9oW7Apt1";
const TEST_EMAIL = "nolan796@live.ca";

export default function AppBuilderEditorV3(props: React.ComponentProps<typeof AppBuilderEditor>) {
    const { user } = useAuth();
    const enabledForAll = process.env.NEXT_PUBLIC_WORKSPACE_AUTONOMY_V3_ENABLED_FOR_ALL === "true";
    const allowed = enabledForAll && Boolean(user?.uid)
        ? true
        : user?.uid === TEST_UID || user?.email?.toLowerCase() === TEST_EMAIL;
    if (!allowed) return null;
    return <AppBuilderEditor {...props} initialViewMode="ai" agentMode="v3" />;
}
