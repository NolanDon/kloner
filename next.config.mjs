// next.config.mjs
const IMG_SRC = [
    "'self'",
    'data:',
    'blob:',
    'https://storage.googleapis.com',
    'https://firebasestorage.googleapis.com',
    'https://tracksitechanges-5743f.firebasestorage.app',
].join(' ');

const CSP = [
    "default-src 'self'",
    `img-src ${IMG_SRC}`,
    // keep your other directives as-is (script-src, style-src, connect-src, etc.)
].join('; ');

export default {
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'Content-Security-Policy', value: CSP },
                ],
            },
        ];
    },
};
