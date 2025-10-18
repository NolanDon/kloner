import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";

/**
 * Animated, realistic Overdrive credit card
 * - Mouse tilt + parallax
 * - Scroll-driven rotation
 * - Subtle erratic jitter
 * - Moving glare highlight that follows the cursor
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
    // tilt range for x/y in degrees
    const rotX = useTransform(smy, (v) => (v - 0.5) * -20); // invert so moving mouse up tilts back
    const rotY = useTransform(smx, (v) => (v - 0.5) * 30);
    const rotZ = useTransform(ssy, (v) => (v % 360) * 0.02);

    const jitterX = useTransform(sjx, (v) => v);
    const jitterY = useTransform(sjy, (v) => v);
    const jitterZ = useTransform(sjz, (v) => v);

    const finalRotX = useTransform([rotX, jitterX], ([a, b]) => a as any + b);
    const finalRotY = useTransform([rotY, jitterY], ([a, b]) => a as any + b);
    const finalRotZ = useTransform([rotZ, jitterZ], ([a, b]) => a as any + b);

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

            // glare follows the cursor
            gx.set(px * 100);
            gy.set(py * 100);
        };

        const onScroll = () => {
            sy.set(window.scrollY);
            // make glare drift slightly with scroll too
            gx.set(((sgx.get() / 100 + 0.0025 * window.scrollY) % 1) * 100);
            gy.set(((sgy.get() / 100 + 0.0015 * window.scrollY) % 1) * 100);
        };

        // erratic jitter loop
        let raf = 0;
        const jitterLoop = () => {
            // small random spikes
            sjx.set((Math.random() - 0.5) * 2.2);
            sjy.set((Math.random() - 0.5) * 2.2);
            sjz.set((Math.random() - 0.5) * 1.8);
            raf = window.setTimeout(jitterLoop, 260 + Math.random() * 260) as unknown as number;
        };

        el.addEventListener('pointermove', onPointerMove);
        window.addEventListener('scroll', onScroll, { passive: true });
        jitterLoop();

        return () => {
            el.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('scroll', onScroll);
            window.clearTimeout(raf);
        };
    }, [gx, gy, mx, my, sjx, sjy, sjz, sgx, sgy, sy]);

    return (
        <div className="relative w-full flex justify-center md:block">
            <motion.div
                ref={ref}
                className="
          relative select-none
          w-[88vw] max-w-[380px] md:max-w-[420px]
          aspect-[85/54] rounded-2xl md:rounded-3xl
          shadow-[0_25px_50px_-12px_rgba(0,0,0,0.35)]
          ring-1 ring-black/5
          overflow-hidden
          will-change-transform
          cursor-pointer
        "
                style={{
                    transformStyle: 'preserve-3d',
                    rotateX: finalRotX,
                    rotateY: finalRotY,
                    rotateZ: finalRotZ,
                }}
            >
                {/* Card base gradient */}
                <div
                    className="
            absolute inset-0
            bg-[radial-gradient(120%_80%_at_10%_10%,#1e90ff_0%,#7b61ff_35%,#b14bff_60%,#111827_100%)]
            "
                />

                {/* Subtle texture */}
                <div className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
                    style={{
                        backgroundImage:
                            'repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 1px, transparent 1px, transparent 6px)',
                    }}
                />

                {/* Moving spectral sheen */}
                <motion.div
                    className="absolute inset-0 opacity-70"
                    style={{
                        background:
                            'conic-gradient(from 180deg at 50% 50%, rgba(255,255,255,0.14), rgba(255,255,255,0.04), rgba(255,255,255,0.18), rgba(255,255,255,0.05))',
                        translateZ: 30, // slight float
                    }}
                />

                {/* Glare that follows cursor
                <motion.div
                    className="absolute -inset-[40%] pointer-events-none mix-blend-screen"
                    style={{
                        background:
                            'radial-gradient(30% 20% at 50% 50%, rgba(255,255,255,0.55), rgba(255,255,255,0.06) 70%, transparent 80%)',
                        left: 'calc(var(--gx,50) * 1%)',
                        top: 'calc(var(--gy,50) * 1%)',
                        translateX: '-50%',
                        translateY: '-50%',
                        // Bind CSS vars to springs
                        ['--gx' as any]: sgx,
                        ['--gy' as any]: sgy,
                        translateZ: 10,
                    }}
                /> */}

                {/* Brand + contactless + chip row */}
                <div className="relative z-10 p-5 md:p-6 flex items-center justify-between" style={{ translateZ: 40 } as any}>
                    <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-white/90" />
                        <div className="h-6 w-10 rounded-full bg-white/60" />
                    </div>
                    <div className="text-white/90 text-xs tracking-[0.18em] uppercase">
                        Overdrive
                    </div>
                </div>

                {/* Chip + NFC */}
                <div className="relative z-10 px-5 md:px-6" style={{ translateZ: 50 } as any}>
                    <div className="flex items-center gap-3">
                        <div
                            className="w-12 h-9 rounded-md"
                            style={{
                                background:
                                    'linear-gradient(160deg, #d9d9d9, #b8b8b8 40%, #efefef 60%, #9d9d9d)',
                                boxShadow:
                                    'inset 0 0 0 1px rgba(0,0,0,0.35), inset 0 0 0 2px rgba(255,255,255,0.35)',
                            }}
                        />
                        <div className="text-white/80 text-[10px] tracking-wide">
                            tap • pay • perform
                        </div>
                    </div>
                </div>

                {/* Number */}
                <div className="relative z-10 px-5 md:px-6 pt-3" style={{ translateZ: 60 } as any}>
                    <div
                        className="text-white/95 tracking-[0.28em] text-xl md:text-2xl font-semibold"
                        style={{
                            textShadow: '0 1px 0 rgba(0,0,0,0.35)',
                            letterSpacing: '0.28em',
                        }}
                    >
                        5234  8612  0941  7325
                    </div>
                </div>

                {/* Name / Expiry / Network */}
                <div className="relative z-10 px-5 md:px-6 pt-4 flex items-end justify-between" style={{ translateZ: 55 } as any}>
                    <div className="space-y-1">
                        <div className="text-white/60 text-[10px]">CARDHOLDER</div>
                        <div className="text-white/90 text-sm tracking-wide">JOHN BOXILL</div>
                    </div>
                    <div className="space-y-1 text-right">
                        <div className="text-white/60 text-[10px]">VALID THRU</div>
                        <div className="text-white/90 text-sm tracking-wide">12/29</div>
                    </div>
                    <div className="text-white/90 text-sm font-semibold tracking-wider">
                        OD
                    </div>
                </div>

                {/* Hologram-ish badge */}
                <div
                    className="absolute bottom-4 right-5 w-12 h-9 rounded-md opacity-80"
                    style={{
                        background:
                            'conic-gradient(from 90deg at 50% 50%, #b3ffcb, #6cc8ff, #ff9bf2, #b3ffcb)',
                        mixBlendMode: 'screen',
                        translateZ: 40,
                    } as any}
                />

                {/* Bottom gloss edge */}
                <div
                    className="absolute inset-x-0 bottom-0 h-12"
                    style={{
                        background:
                            'linear-gradient(to top, rgba(255,255,255,0.18), rgba(255,255,255,0))',
                        translateZ: 35,
                    } as any}
                />
            </motion.div>
        </div>
    );
}