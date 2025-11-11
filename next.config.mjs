// next.config.mjs
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://storage.googleapis.com https://firebasestorage.googleapis.com https://tracksitechanges-5743f.firebasestorage.app",
    "connect-src 'self' https://*.googleapis.com https://*.supabase.co https://firebasestorage.googleapis.com https://storage.googleapis.com",
    "font-src 'self' data:",
    "frame-ancestors 'self'",
    "object-src 'none'; base-uri 'self'"
].join('; ');

export default {
    async headers() {
        return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: CSP }] }];
    },
};
