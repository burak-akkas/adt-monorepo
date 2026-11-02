import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";
const commit = process.env.COMMIT_SHA ?? "";
const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

const nextConfig: NextConfig = {
  transpilePackages: ["@adt/contracts"],
  // The browser only ever talks to this origin, so session cookies stay first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  env: {
    COMMIT_SHA: commit || "dev",
    API_URL: apiUrl,
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_COMMIT_SHA: commit,
  },
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
