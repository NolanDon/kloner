import { motion } from "framer-motion";

const ACCENT = "#f55f2a";

export default function KlonerLoader() {

    return (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-white">
            <motion.div
                className="relative h-20 w-20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
            >
                {/* outer ring */}
                <span
                    className="absolute inset-0"
                    style={{ borderColor: "rgba(245,95,42,0.18)" }}
                />

                {/* spinning accent ring */}
                <motion.span
                    className="absolute inset-1 rounded-full border-2 border-t-transparent"
                    style={{
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
        </div>
    );
}