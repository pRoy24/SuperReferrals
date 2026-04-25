import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@0gfoundation/0g-ts-sdk",
    "ethers",
    "viem"
  ]
};

export default nextConfig;
