import type { NextConfig } from "next";
import { buildCsp } from "./src/lib/csp";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

// Pages get their CSP from src/proxy.ts (it may include an approved chatbot
// widget's origins). API responses get the base policy with no extra origins.
const apiCsp = { key: "Content-Security-Policy", value: buildCsp([], { dev: process.env.NODE_ENV === "development" }) };

const nextConfig: NextConfig = {
  // Separate build dir for the E2E dev server so it can run alongside a developer server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "pg", "nodemailer"],
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [apiCsp] },
    ];
  },
};

export default nextConfig;
