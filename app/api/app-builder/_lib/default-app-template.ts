// app/api/app-builder/_lib/default-app-template.ts
// Single source of truth for the default app template.
// This is used to self-heal Firestore (system/default_app_template) if it is missing.

export type TemplateFiles = Record<string, { content: string }>;

export const DEFAULT_APP_TEMPLATE_VERSION = "1.0.2";

export const DEFAULT_APP_TEMPLATE_FILES: TemplateFiles = {
    "package.json": {
        content: JSON.stringify(
            {
                name: "my-app",
                version: "0.1.0",
                private: true,
                engines: {
          node: ">=18.17.0",
                },
                scripts: {
                    dev: "next dev",
                    build: "next build",
                    start: "next start",
                    lint: "next lint",
                },
                dependencies: {
          next: "^16.1.6",
          react: "18.3.1",
          "react-dom": "18.3.1",
                    "@supabase/supabase-js": "^2.49.0",
                },
                devDependencies: {
          eslint: "^8.57.0",
          "eslint-config-next": "^16.1.6",
                },
            },
            null,
            2,
        ),
    },
    "next.config.js": {
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '',
  assetPrefix: '',
  images: {
    unoptimized: true,
    domains: ['firebasestorage.googleapis.com'],
  },
  trailingSlash: false,
}

module.exports = nextConfig`,
    },
    "jsconfig.json": {
        content: `{
  "compilerOptions": {}
}`,
    },
    "lib/supabaseClient.js": {
        content: `import { createClient } from "@supabase/supabase-js";

let cached;

export function getSupabaseBrowserClient() {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key);
  return cached;
}
`,
    },
    "app/globals.css": {
        content: `:root {
  --bg0: #0b1020;
  --bg1: #0f172a;
  --card: rgba(255, 255, 255, 0.06);
  --card2: rgba(255, 255, 255, 0.04);
  --border: rgba(255, 255, 255, 0.12);
  --text: rgba(255, 255, 255, 0.92);
  --muted: rgba(255, 255, 255, 0.68);
  --muted2: rgba(255, 255, 255, 0.52);
  --accent: #FF8D21;
  --accent2: #D96E11;
  --shadow: 0 18px 55px rgba(0,0,0,0.45);
  --radius: 18px;
}
* { box-sizing: border-box; }

html, body { height: 100%; }

body {
  margin: 0;
  color: var(--text);
  background:
    radial-gradient(1000px 600px at 20% 10%, rgba(255, 141, 33, 0.22), transparent 55%),
    radial-gradient(900px 500px at 85% 30%, rgba(124, 58, 237, 0.18), transparent 55%),
    linear-gradient(180deg, var(--bg0), var(--bg1));
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}

a { color: inherit; }

.kloner-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 18px;
}

.kloner-card {
  width: min(920px, 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--card), var(--card2));
  box-shadow: var(--shadow);
  overflow: hidden;
}

.kloner-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.10);
}

.kloner-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.kloner-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  box-shadow: 0 0 0 6px rgba(255, 141, 33, 0.14);
}

.kloner-meta {
  font-size: 12px;
  color: var(--muted2);
}

.kloner-body {
  padding: 22px 18px 18px;
}

.kloner-hero {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 18px;
  align-items: start;
}

@media (max-width: 860px) {
  .kloner-hero { grid-template-columns: 1fr; }
}

.kloner-title {
  margin: 0;
  font-size: 34px;
  line-height: 1.08;
}

.kloner-sub {
  margin: 10px 0 0;
  color: var(--muted);
  line-height: 1.55;
}

.kloner-actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn {
  appearance: none;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: var(--text);
  text-decoration: none;
  padding: 10px 12px;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.btn:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.22); background: rgba(255,255,255,0.08); }
.btn:active { transform: translateY(0px); }

.btn-primary {
  border-color: rgba(255, 141, 33, 0.55);
  background: linear-gradient(135deg, rgba(255, 141, 33, 0.95), rgba(255, 122, 69, 0.9));
  color: rgba(0,0,0,0.86);
}

.btn-primary:hover { border-color: rgba(255, 255, 255, 0.16); }

.kloner-panel {
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 14px;
  background: rgba(0,0,0,0.18);
  padding: 14px;
}

.kloner-panel h3 {
  margin: 0 0 8px;
  font-size: 13px;
  letter-spacing: 0.25px;
  color: rgba(255,255,255,0.78);
  text-transform: uppercase;
}

.kloner-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}

.kloner-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
}

.kloner-num {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 141, 33, 0.16);
  border: 1px solid rgba(255, 141, 33, 0.35);
  color: rgba(255,255,255,0.88);
  font-size: 12px;
  font-weight: 700;
}

.kloner-item-title {
  font-weight: 650;
  font-size: 13px;
}

.kloner-item-sub {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(255,255,255,0.64);
  line-height: 1.35;
}

.kloner-foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 18px;
  color: rgba(255,255,255,0.55);
  font-size: 12px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
}
`,
    },
    "app/page.js": {
        content: `'use client';

import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

export default function Home() {
  const [nowText, setNowText] = useState('');

  useEffect(() => {
    setNowText(new Date().toLocaleString());
  }, []);

  return (
    <main className="kloner-shell">
      <div className="kloner-card">
        <div className="kloner-top">
          <div className="kloner-brand">
            <span className="kloner-dot" aria-hidden="true" />
            <span>Kloner</span>
          </div>
          <div className="kloner-meta">Starter app · {nowText || '—'}</div>
        </div>

        <div className="kloner-body">
          <div className="kloner-hero">
            <div>
              <h1 className="kloner-title">Your app starts here.</h1>
              <p className="kloner-sub">
                This is a lightweight placeholder you can customize. Begin customizing with the agent to make it yours.
              </p>

              <div className="kloner-actions">
                <a className="no-underline btn btn-primary" href="#" onClick={(e) => e.preventDefault()}>
                  Primary action
                </a>
                <a className="no-underline btn" href="#" onClick={(e) => e.preventDefault()}>
                  Secondary action
                </a>
              </div>
            </div>

            <aside className="kloner-panel">
              <h3>Quick start</h3>
              <ul className="kloner-list">
                <li className="kloner-item">
                  <span className="kloner-num">1</span>
                  <div>
                    <div className="kloner-item-title">Edit content</div>
                    <div className="kloner-item-sub">Change text + layout in <b>app/page.js</b>.</div>
                  </div>
                </li>
                <li className="kloner-item">
                  <span className="kloner-num">2</span>
                  <div>
                    <div className="kloner-item-title">Style it</div>
                    <div className="kloner-item-sub">Tweak colors + spacing in <b>app/globals.css</b>.</div>
                  </div>
                </li>
                <li className="kloner-item">
                  <span className="kloner-num">3</span>
                  <div>
                    <div className="kloner-item-title">Deploy</div>
                    <div className="kloner-item-sub">Use the Deploy modal in Kloner to publish preview or live.</div>
                  </div>
                </li>
              </ul>
            </aside>
          </div>
        </div>

        <div className="kloner-foot">
          <span className="pill">Built with Next.js</span>
          <span className="pill">Kloner placeholder</span>
        </div>
      </div>
    </main>
  );
}`,
    },
    "app/layout.js": {
        content: `import './globals.css';

export const metadata = {
  title: 'Kloner App',
  description: 'A Kloner starter app.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
    },
    "app/error.js": {
        content: `'use client';

export default function Error({ error, reset }) {
  return (
    <main className="kloner-shell">
      <div className="kloner-card">
        <div className="kloner-top">
          <div className="kloner-brand">
            <span className="kloner-dot" aria-hidden="true" />
            <span>Kloner</span>
          </div>
          <div className="kloner-meta">Error</div>
        </div>
        <div className="kloner-body">
          <h1 className="kloner-title" style={{ fontSize: 26 }}>Something went wrong.</h1>
          <p className="kloner-sub" style={{ marginTop: 10 }}>
            The service is temporarily unavailable. Please try again in a few minutes.
          </p>
          <p className="kloner-sub" style={{ marginTop: 6 }}>
            If this keeps happening, contact support and include what you were trying to do.
          </p>
          <div className="kloner-actions">
            <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
          </div>
        </div>
      </div>
    </main>
  );
}`,
    },
};
