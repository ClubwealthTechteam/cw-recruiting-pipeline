/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
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
