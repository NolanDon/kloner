import { useRef, useEffect } from "react";

export default function RetroGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) return;

    let animationId: number;
    let t = 0;

    function draw() {
      const w = canvas!.width = canvas!.offsetWidth;
      const h = canvas!.height = canvas!.offsetHeight;
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
      ctx!.shadowBlur = 6;
      ctx!.lineWidth = 2;

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
      animationId = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block"
      style={{ display: "block", zIndex: 0 }}
    />
  );
}
