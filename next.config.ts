import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Curated guides are read from disk at request time, so serverless bundles must include them.
  outputFileTracingIncludes: {
    "/**": ["./content/guides/**/*.json"],
  },
};

export default nextConfig;
