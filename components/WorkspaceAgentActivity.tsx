"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function WorkspaceAgentProgress({ text }: { text: string }) {
    const reduced = useReducedMotion();
    return (
        <div className="relative grid min-h-[3.5rem] overflow-hidden text-sm leading-relaxed" aria-live="polite">
            <AnimatePresence initial={false}>
                <motion.div key={text} className="col-start-1 row-start-1 self-center"
                    initial={{ opacity: 0, y: reduced ? 0 : 24 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduced ? 0 : -24 }} transition={{ duration: reduced ? 0 : 0.3 }}>
                    {text}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}

export function WorkspaceAgentLoader() {
    return <div role="status" aria-label="Your assistant is working" className="flex w-fit gap-1.5 rounded-full border border-[#FF8D21]/15 bg-orange-50/60 px-4 py-3">
        {[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[#FF8D21] motion-safe:animate-bounce" style={{ animationDelay: `${dot * 150}ms` }} />)}
    </div>;
}
