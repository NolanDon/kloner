"use client";

import { useAuth } from "@/src/hooks/useAuth";
import AppBuilderEditor from "./AppBuilderEditor";
import AppBuilderEditorV3 from "./AppBuilderEditorV3";

const TEST_UID = "FJPVD2BuHrXBLhOFOBWi9oW7Apt1";
const TEST_EMAIL = "nolan796@live.ca";

export default function AppBuilderEditorRouted(props: React.ComponentProps<typeof AppBuilderEditor>) {
    const { user } = useAuth();
    // V3 is the production default now. Set the env flag to "false" to roll
    // back to the legacy editor without changing routing code.
    const allUsers = process.env.NEXT_PUBLIC_WORKSPACE_AUTONOMY_V3_ENABLED_FOR_ALL !== "false";
    const v3User = allUsers && Boolean(user?.uid) || user?.uid === TEST_UID || user?.email?.toLowerCase() === TEST_EMAIL;
    return v3User ? <AppBuilderEditorV3 {...props} /> : <AppBuilderEditor {...props} />;
}
