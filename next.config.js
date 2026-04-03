/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  rewrites: async () => [
    // Production must rewrite to `/api/` (single serverless entry), not `/api/:path*`.
    // Otherwise Vercel routes `/api/health` to Next.js (404) instead of `api/index.py`.
    // See: https://github.com/digitros/nextjs-fastapi/blob/main/next.config.js
    {
      source: "/api/py/:path*",
      destination:
        process.env.NODE_ENV === "development"
          ? "http://127.0.0.1:8000/api/py/:path*"
          : "/api/"
    }
  ]
};

module.exports = nextConfig;
