// middleware.ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

export function middleware(req) {
    const nonce = crypto.randomBytes(16).toString('base64');

    const csp = [
        "default-src 'self'",
        // inline scripts allowed only with this per-request nonce; strict-dynamic lets trusted scripts load others
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
        // allow inline styles from Tailwind/Next and any CSS files
        "style-src 'self' 'unsafe-inline' https:",
        // permit images from your GCS/Firebase storage + data/blob
        "img-src 'self' data: blob: https://storage.googleapis.com https://firebasestorage.googleapis.com https://tracksitechanges-5743f.firebasestorage.app",
        // all fetch/XHR/SSE/WebSocket targets you hit from the browser
        "connect-src 'self' https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://*.supabase.co https://ntwimzyxpxdwvbjpryyd.supabase.co https://ntwimzyxpxdwvbjpryyd.functions.supabase.co",
        // fonts
        "font-src 'self' data: https://fonts.gstatic.com",
        // frames (Firebase Auth popup/iframe, Google One-Tap, etc.). Note: third-party sites like Upwork won’t allow framing due to X-Frame-Options.
        "frame-src 'self' https://accounts.google.com https://*.google.com https://*.gstatic.com",
        // required for Next/Image optimizer and workers
        "worker-src 'self' blob:",
        // disallow plugins
        "object-src 'none'",
        // protect against base tag injection
        "base-uri 'self'",
        // form posts
        "form-action 'self' https://accounts.google.com",
        // prefetch
        "prefetch-src 'self' https:"
    ].join('; ');

    const res = NextResponse.next();
    res.headers.set('Content-Security-Policy', csp);
    res.headers.set('x-nonce', nonce);
    return res;
}

// Exclude Next static assets from the middleware for perf
export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
    ],
};
