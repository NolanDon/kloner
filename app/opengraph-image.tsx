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
          background: "linear-gradient(135deg, #1b0f2a 0%, #2a1b3e 55%, #111827 100%)",
          color: "white",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'",
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
            border: "1px solid rgba(255,255,255,0.12)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: "#F55F2A",
              }}
            />
            <div style={{ fontSize: 26, letterSpacing: -0.5, opacity: 0.9, display: "flex" }}>
              kloner.app
            </div>
          </div>

          <div style={{ fontSize: 86, fontWeight: 800, lineHeight: 1.02, display: "flex", flexDirection: "column" }}>
            Clone.
            <span style={{ color: "#F55F2A" }}> Customize.</span> Deploy.
          </div>

          <div style={{ fontSize: 30, opacity: 0.9, maxWidth: 820, lineHeight: 1.35, display: "flex" }}>
            Paste a URL to generate an editable preview, export clean HTML, and ship faster.
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 8,
              flexWrap: "wrap",
              fontSize: 22,
              opacity: 0.9,
            }}
          >
            <span style={{ padding: "8px 14px", borderRadius: 999, background: "rgba(255,255,255,0.10)" }}>
              AI preview builder
            </span>
            <span style={{ padding: "8px 14px", borderRadius: 999, background: "rgba(255,255,255,0.10)" }}>
              Export HTML
            </span>
            <span style={{ padding: "8px 14px", borderRadius: 999, background: "rgba(255,255,255,0.10)" }}>
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
