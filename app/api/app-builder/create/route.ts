// app/api/app-builder/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const initialTemplate = {
    "package.json": {
        content: JSON.stringify({
            name: "my-app",
            version: "0.1.0",
            private: true,
            scripts: {
                dev: "next dev",
                build: "next build",
                start: "next start",
                lint: "next lint"
            },
            dependencies: {
                next: "14.0.0",
                react: "^18",
                "react-dom": "^18"
            },
            devDependencies: {
                eslint: "^8",
                "eslint-config-next": "14.0.0"
            }
        }, null, 2),
    },
    "app/page.js": {
        content: `export default function Home() {
  return (
    <main>
      <h1>Welcome to My App</h1>
      <p>This is your new Next.js app!</p>
    </main>
  );
}`,
    },
    "app/layout.js": {
        content: `export const metadata = {
  title: 'My App',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
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
                                        next: "14.0.0",
                                        react: "^18",
                                        "react-dom": "^18"
                                    },
                                    devDependencies: {
                                        eslint: "^8",
                                        "eslint-config-next": "14.0.0"
                                    }
                                }, null, 2),
                            },
                            "app/page.js": {
                                content: `export default function Home() {
  return (
    <main dangerouslySetInnerHTML={{ __html: \`${renderData.html.replace(/`/g, '\\`')}\` }} />
  );
}`,
                            },
                            "app/layout.js": {
                                content: `export const metadata = {
  title: '${name}',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
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

        await db.collection("user_apps").doc(appId).set({
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