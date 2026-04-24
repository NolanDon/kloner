import { motion } from "framer-motion";

type KlonerLoaderProps = {
    title?: string;
};

export default function KlonerLoader({ title = "Loading preview..." }: KlonerLoaderProps) {

    return (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-white">
            <motion.div
                className="flex flex-col items-center justify-center text-center"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
            >
                <div className="kloner-dots" aria-hidden="true">
                    <span className="kloner-dot" />
                    <span className="kloner-dot" />
                    <span className="kloner-dot" />
                </div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-600">
                    {title}
                </div>
            </motion.div>
        </div>
    );
}