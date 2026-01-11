import { useRef, useEffect } from "react";

export default function RetroGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    let animationId: number | undefined;
    let t = 0;
    let width = 0;
    let height = 0;
    let active = true;
    let lastTs = 0;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    const resize = () => {
      const nextW = canvas.offsetWidth;
      const nextH = canvas.offsetHeight;
      if (!nextW || !nextH) return;
      if (nextW === width && nextH === height) return;
      width = nextW;
      height = nextH;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const stop = () => {
      if (animationId) cancelAnimationFrame(animationId);
      animationId = undefined;
    };

    const start = () => {
      if (animationId || prefersReduced) return;
      animationId = requestAnimationFrame(loop);
    };

    function drawFrame() {
      const w = width;
      const h = height;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);

      // Responsive parameters based on viewport width
      const isMobile = w < 640;
      const isTablet = w < 1024;
      let horizon, lines, vlines;
      
      if (isMobile) {
        horizon = h * 0.01;
        lines = 22; // more horizontal lines
        vlines = 8; // fewer vertical lines = wider grid cells
      } else if (isTablet) {
        horizon = h * 0.10;
        lines = 19;
        vlines = 11;
      } else {
        horizon = h * 0.20;
        lines = 16;
        vlines = 14;
      }

      const speed = 0.002;
      t += speed;

      // Set shadow once, not per-line
      ctx!.shadowColor = "#00ff99";
      ctx!.shadowBlur = 4;
      ctx!.lineWidth = 1.5;

      // Draw horizontal lines (true perspective spacing)
      const vX = w / 2;
      const vY = horizon;
      const denom = vY - h;
      for (let i = 1; i < lines; i++) {
        const z = i + (t % 1);
        const y = horizon + (h - horizon) / z;
        if (y > h * 0.98) continue;
        
        const tParam = (y - h) / denom;
        const tClamped = Math.max(0, Math.min(1, tParam));
        const xL = vX * tClamped;
        const xR = w + (vX - w) * tClamped;
        
        // Simplify alpha calculation
        const alpha = Math.min(1, (y - vY) / (h * 0.6));
        ctx!.strokeStyle = `rgba(255,255,254,${Math.max(0, alpha * 0.65)})`;
        
        ctx!.beginPath();
        ctx!.moveTo(xL, y);
        ctx!.lineTo(xR, y);
        ctx!.stroke();
      }

      // Draw vertical lines
      ctx!.strokeStyle = "rgba(255,255,254,0.50)";
      for (let i = 0; i <= vlines; i++) {
        const x = w * (i / vlines);
        ctx!.beginPath();
        ctx!.moveTo(x, h);
        ctx!.lineTo(vX, vY);
        ctx!.stroke();
      }

      ctx!.shadowBlur = 0;
    }

    function loop(ts: number) {
      if (!active) return;

      // Throttle a bit (~45fps) for better battery/CPU
      if (ts - lastTs < 22) {
        animationId = requestAnimationFrame(loop);
        return;
      }
      lastTs = ts;

      drawFrame();
      animationId = requestAnimationFrame(loop);
    }

    // Pause animation when tab is hidden
    const onVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      if (hidden) {
        stop();
      } else if (active) {
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Pause when offscreen
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        active = !!entry?.isIntersecting;
        if (!active) stop();
        else start();
      },
      { root: null, threshold: 0.01 }
    );
    io.observe(canvas);

    // Initial render
    drawFrame();
    start();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block"
      style={{ display: "block", zIndex: 0 }}
    />
  );
}
