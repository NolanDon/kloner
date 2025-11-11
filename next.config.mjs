// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            // Bucket as a website-style path under storage.googleapis.com
            {
                protocol: 'https',
                hostname: 'storage.googleapis.com',
                port: '',
                pathname: '/tracksitechanges-5743f.firebasestorage.app/**',
            },
            // Direct bucket host if you ever flip to region-specific endpoints
            {
                protocol: 'https',
                hostname: '*.storage.googleapis.com',
                port: '',
                pathname: '/tracksitechanges-5743f.firebasestorage.app/**',
            },
            // Firebase Storage REST style (optional, for v0/b/.../o/... URLs)
            {
                protocol: 'https',
                hostname: 'firebasestorage.googleapis.com',
                port: '',
                pathname: '/v0/b/tracksitechanges-5743f.firebasestorage.app/o/**',
            },
            // If you ever serve from the bucket hostname directly (optional)
            {
                protocol: 'https',
                hostname: 'tracksitechanges-5743f.firebasestorage.app',
                port: '',
                pathname: '/**',
            },
        ],
    },
};
export default nextConfig;
