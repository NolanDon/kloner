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
                    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
                ],
            },
        ];
    },
    webpack: (config, { isServer }) => {
        if (isServer) {
            // Ensure server chunks are emitted next to the server runtime.
            // This avoids build-time chunk resolution failures where the runtime
            // attempts `require("./<id>.js")` but chunks were written under `chunks/`.
            config.output.chunkFilename = '[id].js';
        }

        return config;
    },
};

export default nextConfig;
