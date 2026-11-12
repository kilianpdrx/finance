import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // middleware.ts runs on /api/*, so Next buffers every request body for it —
    // and keeps only the first 10 MB by default, silently: a restore of a backup
    // above 10 MB reached the API cut short and was refused as « corrompue ».
    // Above the API's own cap on a restore (200 MB, routers/system.py).
    middlewareClientMaxBodySize: "210mb",
    // Next keeps the pages it serves in a cache, written by default to
    // .next/server/ next to the server. In the desktop app that folder is INSIDE
    // the installed application: writing there broke its signature (« a sealed
    // resource is missing or invalid »), and fails where the app is read-only.
    // The pages are static, so a cache in memory loses nothing (Docker too).
    isrFlushToDisk: false,
  },
};

export default nextConfig;
