import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["cheerio"],
  experimental: {
    // Article generation + WordPress publish runs after the HTTP response.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
