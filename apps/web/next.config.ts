import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@adt/contracts"],
  // The browser only ever talks to this origin, so session cookies stay first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  env: { COMMIT_SHA: process.env.COMMIT_SHA ?? "dev", API_URL: apiUrl },
};

export default nextConfig;
