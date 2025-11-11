/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        unoptimized: true,
        domains: ['firebasestorage.googleapis.com'],
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
};


module.exports = nextConfig;
