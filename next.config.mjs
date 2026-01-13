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
};

export default nextConfig;
