export function formatWorkspaceRestoreError(error: unknown): string {
    const value = error as { code?: string; message?: string; requestId?: string } | null;
    const message = typeof value?.message === "string" ? value.message : "I couldn't restore that change. Please try again.";
    if (value?.code !== "HTML_FILE_EMPTY_BEFORE_PERSIST" && !message.includes("HTML file was empty before persistence")) return message;
    const reference = value?.requestId ? ` Reference: ${value.requestId}.` : "";
    return `Undo couldn’t safely restore a saved page. Please retry; if it keeps failing, contact support.${reference}`;
}
