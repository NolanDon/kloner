/** @type {import('next').NextConfig} */
const csp = [
    "default-src 'self';",
    // allow inline styles + Google Fonts if you use them
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
    "font-src 'self' https://fonts.gstatic.com;",
    // images (adjust if you load from more CDNs)
    "img-src 'self' data: blob: https://www.gstatic.com;",
    // scripts (Firebase + Google APIs)
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://apis.google.com;",
    // XHR / fetch targets (Firebase + Google APIs)
    "connect-src 'self' https://www.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://tracksitechanges-5743f.firebaseapp.com;",
    // ✅ critical line: allow Firebase auth domain to be framed
    "frame-src 'self' https://accounts.google.com https://*.google.com https://*.gstatic.com https://tracksitechanges-5743f.firebaseapp.com;",
    // form submissions (Google auth)
    "form-action 'self' https://accounts.google.com;",
    "base-uri 'self';",
].join(" ");

const nextConfig = {
    images: {
        remotePatterns: [],
    },
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    {
                        key: "Content-Security-Policy",
                        value: csp,
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
