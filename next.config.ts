import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@0gfoundation/0g-ts-sdk",
    "ethers",
    "samsar-js",
    "viem"
  ]
};

export default nextConfig;
