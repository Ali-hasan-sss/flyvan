import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@flyvan/ui"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  },
};

export default nextConfig;
