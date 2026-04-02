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
          relative select-none
                    w-[72vw] max-w-[270px] md:max-w-[294px]
          aspect-[85/54] rounded-2xl md:rounded-3xl
                                        shadow-[0_28px_70px_-18px_rgba(245,95,42,0.38),0_18px_48px_-18px_rgba(251,146,60,0.26)]
                                        ring-1 ring-white/20
          overflow-hidden
          will-change-transform
          cursor-pointer
        "
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
                    bg-[radial-gradient(120%_80%_at_10%_10%,#ffd28a_0%,#ffb347_34%,#f97316_62%,#2b160d_100%)]
          "
                />

                {/* Subtle texture */}
                <div
                    className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
                    style={{
                        backgroundImage:
                            "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 1px, transparent 1px, transparent 6px)",
                    }}
                />

                {/* Moving spectral sheen */}
                <motion.div
                    className="absolute inset-0 opacity-70"
                    style={{
                        background:
                            "conic-gradient(from 180deg at 50% 50%, rgba(255,255,255,0.14), rgba(255,255,255,0.04), rgba(255,255,255,0.18), rgba(255,255,255,0.05))",
                        translateZ: 30,
                    }}
                />

                {/* Brand + contactless + chip row */}
                <div
                    className="relative z-10 p-5 md:p-6 flex items-center justify-between"
                    style={{ translateZ: 40 } as any}
                >
                    <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-white/90" />
                        <div className="h-6 w-10 rounded-full bg-white/55" />
                    </div>
                    <div className="text-white/90 text-xs tracking-[0.18em] uppercase">
                        Kloner
                    </div>
                </div>

                {/* Chip + NFC */}
                <div className="relative z-10 px-5 md:px-6" style={{ translateZ: 50 } as any}>
                    <div className="flex items-center gap-3">
                        <div
                            className="w-12 h-9 rounded-md"
                            style={{
                                background:
                                    "linear-gradient(160deg, rgba(255,248,240,0.96), rgba(255,216,170,0.7) 42%, rgba(255,243,228,0.92) 64%, rgba(255,184,107,0.55))",
                                boxShadow:
                                    "inset 0 0 0 1px rgba(255,255,255,0.32), inset 0 0 0 2px rgba(255,255,255,0.12)",
                            }}
                        />
                        <div className="text-white/80 text-[10px] tracking-wide">
                            tap • pay • perform
                        </div>
                    </div>
                </div>

                {/* Number */}
                <div className="relative z-10 px-3 pt-3" style={{ translateZ: 60 } as any}>
                    <div
                        className="text-white/95 tracking-[0.28em] text-xl md:text-2xl font-semibold"
                        style={{
                            textShadow: "0 1px 0 rgba(0,0,0,0.35)",
                            letterSpacing: "0.28em",
                        }}
                    >
                        5234&nbsp;8612&nbsp;0941&nbsp;7325
                    </div>
                </div>

                {/* Name / Expiry / Network */}
                {/* ADDED pb-4 on mobile to lift above the rounded edge; keep original on md+ */}
                <div
                    className="relative z-10 px-5 md:px-6 pt-4 pb-4 md:pb-0 flex items-end justify-between"
                    style={{ translateZ: 55 } as any}
                >
                    <div className="space-y-1">
                        <div className="text-white/60 text-[10px]">CARDHOLDER</div>
                        {/* Slightly smaller on mobile to avoid clipping in extreme rotations */}
                        <div className="text-white/90 text-[12px] md:text-sm tracking-wide">
                            JOHN BOXILL
                        </div>
                    </div>
                    <div className="space-y-1 text-right">
                        <div className="text-white/60 text-[10px]">VALID THRU</div>
                        <div className="text-white/90 text-[12px] md:text-sm tracking-wide">
                            12/29
                        </div>
                    </div>
                    <div className="text-white/90 text-[12px] md:text-sm font-semibold tracking-wider">
                        OD
                    </div>
                </div>

                {/* Hologram-ish badge */}
                {/* Nudged down a touch on mobile so new pb doesn't overlap */}
                <div
                    className="absolute bottom-2 md:bottom-4 right-5 w-12 h-9 rounded-md opacity-80"
                    style={{
                        background:
                            "conic-gradient(from 90deg at 50% 50%, #ffd27a, #ff9f43, #f97316, #ffd27a)",
                        mixBlendMode: "screen",
                        translateZ: 40,
                    } as any}
                />

                {/* Bottom gloss edge */}
                <div
                    className="absolute inset-x-0 bottom-0 h-12"
                    style={{
                        background: "linear-gradient(to top, rgba(255,255,255,0.18), rgba(255,255,255,0))",
                        translateZ: 35,
                    } as any}
                />
            </motion.div>
        </div>
    );
}
