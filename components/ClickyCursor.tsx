// at top
import { MousePointer } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Cursor with tip-aligned pulse.
 * - Inner glow sits at the pointer’s tip (not the tail).
 * - Slower + larger ripple.
 * - Offsets scale with `size` but can be nudged via props.
 */
export const ClickyCursor = ({
    size = 50,
    nudgeX = 0, // fine-tune in px if needed
    nudgeY = 0,
}: {
    size?: number;
    nudgeX?: number;
    nudgeY?: number;
}) => {
    // Lucide MousePointer viewBox is 24. Tip is near (~5.5, ~3.7).
    const s = size / 24;
    const tipX = (-size * 0.38) + nudgeX; // move the pulse toward the pointer tip
    const tipY = (-size * 0.38) + nudgeY;

    return (
        <motion.div
            className="relative inline-grid place-items-center pointer-events-none"
            animate={{ x: [0, 0, 3, 0, 0], y: [0, 0, 3, 0, 0], scale: [1, 1, 0.96, 1, 1] }}
            transition={{ duration: 3.6, times: [0, 0.6, 0.65, 0.72, 1], repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" }}
            style={{ width: size, height: size }}
        >
            <MousePointer size={size} className="text-neutral-900 z-10" />

            {/* Ripple (slow + big) */}
            <motion.span
                className="absolute rounded-full"
                style={{
                    left: 0,
                    top: 0,
                    width: 6 * s,
                    height: 6 * s,
                    transform: `translate(${tipX}px, ${tipY}px)`,
                    boxShadow: "0 0 0 2px rgba(0,0,0,0.15)",
                }}
                animate={{ opacity: [0, 0, 0.5, 0], scale: [0.2, 0.2, 2.4, 3.2] }}
                transition={{ duration: 3.6, times: [0, 0.58, 0.76, 0.98], repeat: Infinity, repeatDelay: 1.2, ease: "easeOut" }}
            />

            {/* Inner pulse (at tip) */}
            <motion.span
                className="absolute z-5 rounded-full"
                style={{
                    left: 0,
                    top: 0,
                    width: 5 * s,
                    height: 5 * s,
                    background: "var(--accent, #f55f2a)",
                    transform: `translate(${tipX}px, ${tipY}px)`,
                    filter: "blur(1px)",
                }}
                animate={{
                    opacity: [0, 0.2, 1, 0],
                    scale: [0.7, 0.9, 1.9, 2.2],
                    boxShadow: [
                        "0 0 0px rgba(245,95,42,0)",
                        "0 0 8px rgba(245,95,42,0.25)",
                        "0 0 14px rgba(245,95,42,0.35)",
                        "0 0 0px rgba(245,95,42,0)",
                    ],
                }}
                transition={{ duration: 3.6, times: [0, 0.62, 0.78, 0.98], repeat: Infinity, repeatDelay: 1.2, ease: "easeOut" }}
            />
        </motion.div>
    );
};
