import { motion } from "framer-motion";

const ACCENT = "#f55f2a";

type KlonerLoaderProps = {
    inline?: boolean;
    icon?: boolean;
    label?: string;
    sublabel?: string;
};

export default function KlonerLoader({
    inline = false,
    icon = false,
    label,
    sublabel,
}: KlonerLoaderProps = {}) {
    const spinner = (
        <motion.div
            className={icon ? "relative h-8 w-8" : "relative h-10 w-10"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
        >
            <motion.span
                className={`absolute inset-0 rounded-full border-2 border-t-transparent ${icon ? "border-neutral-300 border-t-neutral-700" : ""}`}
                style={icon ? undefined : {
                    borderColor: ACCENT,
                    borderTopColor: "transparent",
                }}
                initial={{ rotate: 0 }}
                animate={{ rotate: 360 }}
                transition={{
                    duration: 1.1,
                    repeat: Infinity,
                    repeatType: "loop",
                    ease: "linear",
                }}
            />
        </motion.div>
    );

    if (icon) {
        return spinner;
    }

    if (inline) {
        return (
            <div className="mt-2 sm:mt-3 mb-4 mx-2 sm:mx-3 md:mx-4 rounded-2xl bg-white p-5 sm:p-6 grid place-items-center min-h-[160px] shadow-sm">
                {spinner}
                {(label || sublabel) ? (
                    <div className="mt-3 text-center">
                        {label ? <div className="text-sm font-semibold text-neutral-900">{label}</div> : null}
                        {sublabel ? <div className="mt-1 text-xs leading-5 text-neutral-500">{sublabel}</div> : null}
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-white">
            {spinner}
        </div>
    );
}