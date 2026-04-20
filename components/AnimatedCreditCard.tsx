import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";

/**
 * Animated, realistic Overdrive credit card
 */
export function AnimatedCreditCard() {
    const ref = useRef<HTMLDivElement | null>(null);

    // Mouse position relative to card
    const mx = useMotionValue(0);
    const my = useMotionValue(0);

    // Jitter values (erratic movement)
    const jx = useMotionValue(0);
    const jy = useMotionValue(0);
    const jz = useMotionValue(0);

    // Scroll coupling
    const sy = useMotionValue(0);

    // Smoothed springs
    const smx = useSpring(mx, { stiffness: 120, damping: 15, mass: 0.25 });
    const smy = useSpring(my, { stiffness: 120, damping: 15, mass: 0.25 });
    const sjx = useSpring(jx, { stiffness: 100, damping: 18 });
    const sjy = useSpring(jy, { stiffness: 100, damping: 18 });
    const sjz = useSpring(jz, { stiffness: 80, damping: 16 });
    const ssy = useSpring(sy, { stiffness: 50, damping: 20 });

    // Rotate based on mouse + jitter + scroll
    const rotX = useTransform(smy, (v) => (v - 0.5) * -20);
    const rotY = useTransform(smx, (v) => (v - 0.5) * 30);
    const rotZ = useTransform(ssy, (v) => (v % 360) * 0.02);

    const jitterX = useTransform(sjx, (v) => v);
    const jitterY = useTransform(sjy, (v) => v);
    const jitterZ = useTransform(sjz, (v) => v);

    const finalRotX = useTransform([rotX, jitterX], ([a, b]) => (a as any) + b);
    const finalRotY = useTransform([rotY, jitterY], ([a, b]) => (a as any) + b);
    const finalRotZ = useTransform([rotZ, jitterZ], ([a, b]) => (a as any) + b);

    // Glare position
    const gx = useMotionValue(50);
    const gy = useMotionValue(50);
    const sgx = useSpring(gx, { stiffness: 100, damping: 20 });
    const sgy = useSpring(gy, { stiffness: 100, damping: 20 });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const onPointerMove: any = (e: PointerEvent) => {
            const rect = el.getBoundingClientRect();
            const px = (e.clientX - rect.left) / rect.width;
            const py = (e.clientY - rect.top) / rect.height;

            mx.set(px);
            my.set(py);

            gx.set(px * 100);
            gy.set(py * 100);
        };

        const onScroll = () => {
            sy.set(window.scrollY);
            gx.set(((sgx.get() / 100 + 0.0025 * window.scrollY) % 1) * 100);
            gy.set(((sgy.get() / 100 + 0.0015 * window.scrollY) % 1) * 100);
        };

        let raf = 0;
        const jitterLoop = () => {
            sjx.set((Math.random() - 0.5) * 2.2);
            sjy.set((Math.random() - 0.5) * 2.2);
            sjz.set((Math.random() - 0.5) * 1.8);
            raf = window.setTimeout(jitterLoop, 260 + Math.random() * 260) as unknown as number;
        };

        el.addEventListener("pointermove", onPointerMove);
        window.addEventListener("scroll", onScroll, { passive: true });
        jitterLoop();

        return () => {
            el.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("scroll", onScroll);
            window.clearTimeout(raf);
        };
    }, [gx, gy, mx, my, sjx, sjy, sjz, sgx, sgy, sy]);

    return (
        <div className="relative w-full flex justify-center md:block">
            <motion.div
                ref={ref}
                className="
                    relative select-none flex h-full w-[72vw] max-w-[300px] flex-col overflow-hidden rounded-xl md:max-w-[320px] md:rounded-[20px] shadow-[0_26px_70px_-18px_rgba(245,95,42,0.38),0_18px_42px_-18px_rgba(253,186,116,0.28)] ring-1 ring-white/20 will-change-transform cursor-pointer"
                style={{
                    transformStyle: "preserve-3d",
                    rotateX: finalRotX,
                    rotateY: finalRotY,
                    rotateZ: finalRotZ,
                }}
            >
                {/* Card base gradient */}
                <div
                    className="
            absolute inset-0
                    bg-[linear-gradient(135deg,#ffd28a_0%,#ffb347_32%,#f97316_63%,#2b160d_100%)]
          "
                />

                {/* Subtle texture */}
                <div
                    className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
                    style={{
                        backgroundImage:
                            "repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 1px, transparent 7px)",
                    }}
                />

                {/* Moving spectral sheen */}
                <motion.div
                    className="absolute inset-0 opacity-70"
                    style={{
                        background:
                            "radial-gradient(circle at 22% 18%, rgba(255,255,255,0.20), rgba(255,255,255,0.06) 26%, rgba(255,255,255,0) 46%), conic-gradient(from 180deg at 50% 50%, rgba(255,255,255,0.12), rgba(255,255,255,0.04), rgba(255,255,255,0.16), rgba(255,255,255,0.05))",
                        translateZ: 30,
                    }}
                />

                <div className="relative z-10 flex h-full flex-col px-4 py-4 md:px-5 md:py-5" style={{ translateZ: 60 } as any}>
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <div className="text-[0.95rem] md:text-[1.05rem] font-medium tracking-[0.02em] text-white/95">
                                Kloner
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                                <div
                                    className="h-8 w-11 rounded-md bg-white/80"
                                    style={{
                                        boxShadow:
                                            "inset 0 0 0 1px rgba(255,255,255,0.22), 0 1px 2px rgba(0,0,0,0.18)",
                                        background:
                                            "linear-gradient(160deg, rgba(255,248,240,0.96), rgba(255,216,170,0.72) 42%, rgba(255,243,228,0.92) 68%, rgba(255,184,107,0.58))",
                                    }}
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-[3px] pt-1 text-white/90">
                            <span className="h-3.5 w-3.5 rounded-full border border-white/70" />
                            <span className="h-4 w-4 rounded-full border border-white/45" />
                            <span className="h-4 w-4 rounded-full border border-white/25" />
                        </div>
                    </div>

                    {/* Spacer to match the reference layout */}
                    <div className="mt-5 flex-1" />

                    {/* Card number */}
                    <div
                        className="text-center font-mono text-[1.03rem] leading-none text-white/95 md:text-[1.2rem]"
                        style={{
                            letterSpacing: "0.20em",
                            textShadow: "0 1px 0 rgba(0,0,0,0.35)",
                        }}
                    >
                        4000&nbsp;1234&nbsp;5678&nbsp;9010
                    </div>

                    {/* Bottom row */}
                    <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                        <div className="min-w-0 space-y-1 text-left">
                            <div className="text-[8px] uppercase tracking-[0.24em] text-white/60">
                                Cardholder Name
                            </div>
                            <div className="truncate text-[0.68rem] tracking-[0.28em] text-white/90 md:text-[0.78rem]">
                                JOHN BOXILL
                            </div>
                        </div>

                        <div className="flex shrink-0 items-end gap-8 text-right">
                            <div className="space-y-1">
                                <div className="text-[8px] uppercase tracking-[0.24em] text-white/60">
                                    Good thru
                                </div>
                                <div className="text-[0.72rem] tracking-[0.26em] text-white/90 md:text-[0.8rem]">
                                    02/30
                                </div>
                            </div>

                            <img
                                src="/images/visa.png"
                                alt="Visa"
                                className="h-7 w-auto origin-right object-contain scale-[1.5] md:h-8 md:scale-[1.65]"
                            />
                        </div>
                    </div>
                </div>

                {/* Bottom gloss edge */}
                <div
                    className="absolute inset-x-0 bottom-0 h-12"
                    style={{
                        background: "linear-gradient(to top, rgba(255,255,255,0.16), rgba(255,255,255,0))",
                        translateZ: 35,
                    } as any}
                />
            </motion.div>
        </div>
    );
}
