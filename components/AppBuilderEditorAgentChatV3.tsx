"use client";

import AppBuilderEditorAgentChat, {
    type AppBuilderEditorAgentChatProps,
} from "./AppBuilderEditorAgentChat";

/**
 * V3 deliberately uses the exact V2 chat surface. The only difference is the
 * transport selected by AppBuilderEditorAgentChat when agentMode is v3.
 */
export default function AppBuilderEditorAgentChatV3(props: Omit<AppBuilderEditorAgentChatProps, "agentMode">) {
    return <AppBuilderEditorAgentChat {...props} agentMode="v3" />;
}
