
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1A1A1A",
        soot: "#0B0C10",
        smoke: "#2B2F36",
        accent: "#F55F2A",
        accent2: "#FF8A4C"
      },
      boxShadow: {
        pill: "0 8px 24px rgba(0,0,0,.12)",
      },
      borderRadius: {
        pill: "999px"
      }
    }
  },
  plugins: []
} satisfies Config;
