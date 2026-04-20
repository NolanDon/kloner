import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
    outputFileTracingRoot: path.resolve("."),
    images: {
        qualities: [75, 82],
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
                source: '/tools/:path*',
                headers: [
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
                ],
            },
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
                source: '/tools/gamertag-generator',
                destination: '/tools/username-generator',
                permanent: true,
            },
            {
                source: '/tools/nickname-generator',
                destination: '/tools/username-generator',
                permanent: true,
            },
            {
                source: '/tools/brand-name-generator',
                destination: '/tools/business-name-generator',
                permanent: true,
            },
            {
                source: '/tools/json-beautifier',
                destination: '/tools/json-formatter',
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
