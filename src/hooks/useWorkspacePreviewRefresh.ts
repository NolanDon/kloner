"use client";

import { useEffect, useRef } from "react";

export function useWorkspacePreviewRefresh(revision: string | undefined, ready: boolean, reload: () => void) {
    const lastRevision = useRef("");
    const latestReload = useRef(reload);
    latestReload.current = reload;
    useEffect(() => {
        if (!ready || !revision || lastRevision.current === revision) return;
        lastRevision.current = revision;
        latestReload.current();
    }, [revision, ready]);
}
