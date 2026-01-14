// app/api/app-builder/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const initialTemplate = {
  "package.json": {
    content: JSON.stringify({
      name: "kloner-app",
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "next lint"
      },
      dependencies: {
        next: "14.2.0",
        react: "^18",
        "react-dom": "^18"
      },
      devDependencies: {
        eslint: "^8",
        "eslint-config-next": "14.2.0"
      }
    }, null, 2),
  },
  "next.config.js": {
    content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '',
  assetPrefix: '',
  images: {
    unoptimized: true,
  },
  trailingSlash: false,
}

module.exports = nextConfig`,
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
  --accent: #f55f2a;
  --accent2: #ff7a45;
  --shadow: 0 18px 55px rgba(0,0,0,0.45);
  --radius: 18px;
}

* { box-sizing: border-box; }

html, body { height: 100%; }

body {
  margin: 0;
  color: var(--text);
  background:
    radial-gradient(1000px 600px at 20% 10%, rgba(245, 95, 42, 0.22), transparent 55%),
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
  box-shadow: 0 0 0 6px rgba(245, 95, 42, 0.14);
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
  padding: 10px 12px;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.btn:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.22); background: rgba(255,255,255,0.08); }
.btn:active { transform: translateY(0px); }

.btn-primary {
  border-color: rgba(245, 95, 42, 0.55);
  background: linear-gradient(135deg, rgba(245, 95, 42, 0.95), rgba(255, 122, 69, 0.9));
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
  background: rgba(245, 95, 42, 0.16);
  border: 1px solid rgba(245, 95, 42, 0.35);
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
    content: `export const dynamic = 'force-dynamic';

export default function Home() {
  const now = new Date();
  return (
    <main className="kloner-shell">
      <div className="kloner-card">
        <div className="kloner-top">
          <div className="kloner-brand">
            <span className="kloner-dot" aria-hidden="true" />
            <span>Kloner</span>
          </div>
          <div className="kloner-meta">Starter app · {now.toLocaleString()}</div>
        </div>

        <div className="kloner-body">
          <div className="kloner-hero">
            <div>
              <h1 className="kloner-title">Your app starts here.</h1>
              <p className="kloner-sub">
                This is a lightweight placeholder you can customize. Edit <b>app/page.js</b> and <b>app/globals.css</b> to make it yours.
              </p>

              <div className="kloner-actions">
                <a className="btn btn-primary" href="#" onClick={(e) => e.preventDefault()}>
                  Primary action
                </a>
                <a className="btn" href="#" onClick={(e) => e.preventDefault()}>
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
            {String(error?.message || 'An unexpected error occurred.')}
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

export async function POST(req: NextRequest) {
  return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
    const db = getAdminDb();

    const body = await req.json();
    const { name, renderId, prompt } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const appId = `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let initialFiles = { ...initialTemplate };

    // If renderId is provided, generate initial content from the render
    if (renderId) {
      try {
        const renderDoc = await db.collection("renders").doc(renderId).get();
        if (renderDoc.exists) {
          const renderData = renderDoc.data();
          if (renderData?.userId === uid && renderData?.html) {
            // Generate basic Next.js app from HTML
            initialFiles = {
              "package.json": {
                content: JSON.stringify({
                  name: name.toLowerCase().replace(/\s+/g, '-'),
                  version: "0.1.0",
                  private: true,
                  scripts: {
                    dev: "next dev",
                    build: "next build",
                    start: "next start",
                    lint: "next lint"
                  },
                  dependencies: {
                    next: "14.2.0",
                    react: "^18",
                    "react-dom": "^18"
                  },
                  devDependencies: {
                    eslint: "^8",
                    "eslint-config-next": "14.2.0"
                  }
                }, null, 2),
              },
              "next.config.js": {
                content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '',
  assetPrefix: '',
  images: {
    unoptimized: true,
  },
  trailingSlash: false,
}

module.exports = nextConfig`,
              },
              "app/globals.css": {
                content: initialTemplate["app/globals.css"].content,
              },
              "app/page.js": {
                content: `export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="kloner-shell">
      <div className="kloner-card">
        <div className="kloner-top">
          <div className="kloner-brand">
            <span className="kloner-dot" aria-hidden="true" />
            <span>Kloner</span>
          </div>
          <div className="kloner-meta">Imported render</div>
        </div>
        <div className="kloner-body">
          <div dangerouslySetInnerHTML={{ __html: \`${renderData.html.replace(/`/g, '\\`')}\` }} />
        </div>
      </div>
    </main>
  );
}`,
              },
              "app/layout.js": {
                content: `import './globals.css';

export const metadata = {
  title: '${name}',
  description: 'Built with Kloner.',
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
            {String(error?.message || 'An unexpected error occurred.')}
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
          }
        }
      } catch (error) {
        console.error("Failed to load render for app creation:", error);
        // Fall back to default template
      }
    }

    const files: Record<string, { content: string; lastModified: number }> = {};
    Object.entries(initialFiles).forEach(([path, { content }]) => {
      files[path] = { content, lastModified: Date.now() };
    });

    await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).set({
      id: appId,
      userId: uid,
      name,
      files,
      renderId: renderId || null, // Store reference to source render
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ appId });
  });
}