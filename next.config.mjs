// next.config.mjs
export default {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "**.blob.vercel-storage.com" }, // Vercel Blob uploads
    ],
    // Only keep this if you actually render SVGs with next/image.
    dangerouslyAllowSVG: true,
    // formats: ["image/avif", "image/webp"], // optional
  },
};
