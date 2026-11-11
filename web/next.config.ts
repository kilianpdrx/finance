import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // middleware.ts runs on /api/*, so Next buffers every request body for it —
    // and keeps only the first 10 MB by default, silently: a restore of a backup
    // above 10 MB reached the API cut short and was refused as « corrompue ».
    // Above the API's own cap on a restore (200 MB, routers/system.py).
    middlewareClientMaxBodySize: "210mb",
  },
};

export default nextConfig;
