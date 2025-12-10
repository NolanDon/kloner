// components/PreviewEditorTour.tsx
"use client";

import { useState, useEffect } from "react";
import Joyride, { CallBackProps, STATUS, Step } from "react-joyride";
import { getFirestore, doc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/src/hooks/useAuth";

const steps: Step[] = [
    {
        target: "#kloner-home",
        content:
            "This is your live editable preview. Feel free to drag it around, this is your sandbox.",
        disableBeacon: true,
    },
    {
        target: "#kloner-page-switcher",
        content: "Use the page switcher to jump between different pages like Home, Pricing, and About. Press Enter to continue.",
        disableBeacon: true,
    },
    // {
    //     target: "#kloner-quick-undo",
    //     content:
    //         "Use undo to step back one change, or redo to move forward again. Both actions update the live preview instantly.",
    //     disableBeacon: true,
    // },
    {
        target: "#kloner-history",
        content: "You can revert to older versions by clicking tabs in the history section.",
        disableBeacon: true,
    },
    {
        target: "#kloner-style-sidebar",
        content: "Use AI Edit to rewrite, generate pictures, or refine copy and layout for the selected block.",
        disableBeacon: true,
    },
    {
        target: "#kloner-apply-changes",
        content: "Apply your changes to update the live preview.",
        disableBeacon: true,
    },
    {
        target: "#kloner-device-toggle",
        content: "Switch between desktop, tablet, and mobile views of your preview. Most changes you make will only affect your currently selected device.",
        disableBeacon: true,
    },

    {
        target: "#kloner-selection-style",
        content: "Fine-tune typography, spacing, alignment, and colors for the currently selected block here.",
        disableBeacon: true,
    },
    {
        target: "#kloner-meta-toggle",
        content:
            "Control page-level SEO here: update titles and descriptions, upload a favicon, and edit advanced JSON-LD for each page.",
        disableBeacon: true,
    },
    {
        target: "#kloner-ai-image-library",
        content:
            "This panel stores all your AI-generated images for your reuse. Drag an image onto any block, or just click a block and the image to auto-insert.",
        disableBeacon: true,
    },
    {
        target: "#kloner-actions-row",
        content: "When your edits are ready, use this to deploy changes to a live website.",
        disableBeacon: true,
    },
];

const LOCAL_KEY = "kloner_preview_tour_done";

const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");

export function PreviewEditorTour() {
    const [run, setRun] = useState(false);
    const { user } = useAuth();
    const db = getFirestore();

    useEffect(() => {
        if (typeof window === "undefined") return;

        // If you're not logged in, just use localStorage gating
        if (!user) {
            const seenLocal = window.localStorage.getItem(LOCAL_KEY) === "1";
            if (!seenLocal) setRun(true);
            return;
        }

        // In localhost: always run so you can test repeatedly
        if (isLocalhost) {
            setRun(true);
            return;
        }

        // In production: still gate by localStorage; Firestore is write-only
        const seenLocal = window.localStorage.getItem(LOCAL_KEY) === "1";
        if (!seenLocal) setRun(true);
    }, [user]);

    const handleJoyrideCallback = async (data: CallBackProps) => {
        const finished =
            data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED;

        if (!finished) return;

        if (typeof window !== "undefined") {
            window.localStorage.setItem(LOCAL_KEY, "1");
        }

        // Only persist flag to Firestore when NOT on localhost
        if (!isLocalhost && user?.uid) {
            try {
                await updateDoc(doc(db, "kloner_users", user.uid), {
                    hasSeenPreviewTour: true,
                });
            } catch {
                // non-critical; ignore
            }
        }

        setRun(false);
    };

    return (
        <Joyride
            run={run}
            steps={steps}
            callback={handleJoyrideCallback}
            continuous
            showProgress
            showSkipButton
            spotlightClicks={true}
            disableOverlayClose={true}
            styles={{
                options: {
                    primaryColor: "#f55f2a",
                    zIndex: 9999999,
                },
            }}
            locale={{
                back: "Back",
                close: "Close",
                last: "Done",
                next: "Next (Press Enter)",
                skip: "Skip",
            }}
        />
    );
}
