import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          color: "#111827",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        }}
      >
        <div
          style={{
            width: 980,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            padding: 64,
            borderRadius: 28,
            border: "1px solid rgba(17,24,39,0.08)",
            background: "#ffffff",
            boxShadow: "0 20px 44px rgba(17,24,39,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                background: "#F55F2A",
              }}
            />
            <div style={{ fontSize: 26, letterSpacing: -0.4, color: "#111827", display: "flex", fontWeight: 500 }}>
              kloner.app
            </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 18px",
                borderRadius: 999,
                background: "#F55F2A",
                color: "#ffffff",
                fontSize: 18,
                fontWeight: 500,
              }}
            >
              Start project
            </div>
          </div>

          <div style={{ fontSize: 82, fontWeight: 500, lineHeight: 1.03, letterSpacing: -1.8, display: "flex", flexDirection: "column" }}>
            Clone.
            <span style={{ color: "#F55F2A" }}>Customize.</span>
            Deploy.
          </div>

          <div style={{ fontSize: 30, color: "#374151", maxWidth: 860, lineHeight: 1.35, display: "flex", fontWeight: 400 }}>
            Drop a link or enter a description to generate an editable preview, export clean HTML, and ship faster.
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 8,
              flexWrap: "wrap",
              fontSize: 21,
            }}
          >
            <span style={{ padding: "10px 16px", borderRadius: 999, background: "#fff", border: "1px solid rgba(17,24,39,0.14)", color: "#111827", fontWeight: 400 }}>
              AI preview builder
            </span>
            <span style={{ padding: "10px 16px", borderRadius: 999, background: "#fff", border: "1px solid rgba(17,24,39,0.14)", color: "#111827", fontWeight: 400 }}>
              Export HTML
            </span>
            <span style={{ padding: "10px 16px", borderRadius: 999, background: "#fff", border: "1px solid rgba(17,24,39,0.14)", color: "#111827", fontWeight: 400 }}>
              One‑click deploy
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
