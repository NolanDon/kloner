import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
    outputFileTracingRoot: path.resolve("."),
    images: {
        qualities: [70, 75, 82],
        formats: ['image/avif', 'image/webp'],
        deviceSizes: [640, 750, 828, 1080, 1200, 1440, 1920],
        imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
        remotePatterns: [
            {
                protocol: "https",
                hostname: "firebasestorage.googleapis.com",
                pathname: "/v0/b/**",
            },
            {
                protocol: "https",
                hostname: "preview.vercel.app",
            },
        ],
    },
    async headers() {
        return [
            {
                // Keep COOP for popup behavior on dashboard routes.
                // Do not force COEP here; strict COEP blocks cross-origin preview iframes
                // (including redirects) in Safari and other strict browsers.
                source: '/dashboard/:path*',
                headers: [
                    // Allow OAuth popups (e.g. Google sign-in) while keeping COOP enabled.
                    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
                ],
            },
        ];
    },
    async redirects() {
        return [
            {
                source: '/blog/website-cloner',
                destination: '/website-cloner',
                permanent: true,
            },
            {
                source: '/blog/clone-a-website-from-a-url',
                destination: '/blog/clone-website-from-url',
                permanent: true,
            },
            {
                source: '/blog/clone-wordpress-site',
                destination: '/blog/clone-wordpress-website',
                permanent: true,
            },
            {
                source: '/blog/wordpress-site-duplicator',
                destination: '/blog/clone-wordpress-website',
                permanent: true,
            },
            {
                source: '/blog/clone-wordpress-theme-from-url',
                destination: '/blog/clone-wordpress-website',
                permanent: true,
            },
            {
                source: '/blog/clone-website-to-html-css',
                destination: '/blog/clone-website-to-html',
                permanent: true,
            },
            {
                source: '/blog/clone-website-ai',
                destination: '/blog/ai-website-cloner',
                permanent: true,
            },
            {
                source: '/blog/site-copier',
                destination: '/blog/website-copier-online',
                permanent: true,
            },
            {
                source: '/blog/website-copier',
                destination: '/blog/website-copier-online',
                permanent: true,
            },
            {
                source: '/blog/website-cloning-guide',
                destination: '/blog/how-to-clone-a-website',
                permanent: true,
            },
            {
                source: '/blog/website-downloader',
                destination: '/blog/website-cloner-vs-website-downloader',
                permanent: true,
            },
            {
                source: '/blog/best-website-builder-for-small-business',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/webflow-website-builder-vs-kloner',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/ai-agent-feedback-loops',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/analytics-for-ai-clone-ops',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/preview-infrastructure-for-ai-clones',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/demo-operations-playbook',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/productionizing-ai-clones-fast',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/ai-website-cloning-to-production',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/market-hypotheses-with-cloned-demos',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/user-research-with-ai-demo-clones',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/ai-agents-for-product-and-growth-teams',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/validate-a-market-with-a-fast-mvp',
                destination: '/blog',
                permanent: true,
            },
            {
                source: '/blog/app/sitemap.ts',
                destination: '/sitemap.xml',
                permanent: true,
            },
            {
                source: '/blog/app/sitemap.ts/',
                destination: '/sitemap.xml',
                permanent: true,
            },
        ];
    },
    webpack: (config, { isServer }) => {
        // Polling keeps Fast Refresh reliable when the repo is mounted through WSL.
        config.watchOptions = {
            ...config.watchOptions,
            poll: 1000,
            aggregateTimeout: 200,
        };
        if (isServer) {
            // Keep server chunks under the default `chunks/` folder.
            // Setting this to `[id].js` causes the server webpack runtime to
            // `require("./<id>.js")` while Next still emits chunks under `chunks/`,
            // which can crash builds with MODULE_NOT_FOUND.
            config.output.chunkFilename = 'chunks/[id].js';
        }

        return config;
    },
};

export default nextConfig;
