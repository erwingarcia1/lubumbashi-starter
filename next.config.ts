import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployment target is Docker Compose (docs/DECISIONS.md D23): self-contained standalone output.
  output: "standalone",
  typedRoutes: true,
};

export default nextConfig;
