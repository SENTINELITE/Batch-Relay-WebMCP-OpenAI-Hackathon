import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Docker image runs the traced server from .next/standalone. The
  // provider routes remain dynamic and keep their credentials server-side.
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
