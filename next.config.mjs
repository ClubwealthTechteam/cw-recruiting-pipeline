/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Baked into the browser code at build time; /api/version returns the live one, so open tabs can tell a new deploy happened.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
  // Keep visited pages in the browser for 60s so going back and forth is instant.
  experimental: { staleTimes: { dynamic: 60, static: 300 } },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
      ]
    }];
  }
};
export default nextConfig;
