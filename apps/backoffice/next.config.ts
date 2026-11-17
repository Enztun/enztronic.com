import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  // Verification must not overwrite the build served by the shared local app.
  ...(process.env.OFFICE_BUILD_DIR === '.next-office-check' || process.env.OFFICE_BUILD_DIR === '.next-office-dev'
    ? { distDir: process.env.OFFICE_BUILD_DIR }
    : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/office/reference/*': ['./office-spec/visuals/reference/*.png'],
    '/api/office/assets': ['./office-assets/assets/office/**/*.glb'],
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
