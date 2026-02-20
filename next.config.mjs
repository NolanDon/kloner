/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
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
                // Enable COEP/COOP for dashboard view which embeds the proxy iframe
                source: '/dashboard/:path*',
                headers: [
                    { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
                    // Allow OAuth popups (e.g. Google sign-in) while keeping COOP enabled.
                    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
                ],
            },
        ];
    },
    async redirects() {
        return [
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
