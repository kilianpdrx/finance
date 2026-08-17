# Multi-arch note (important): the build stages are pinned to $BUILDPLATFORM so
# `npm ci` and `next build` ALWAYS run on the builder's native architecture.
#
# Running them under QEMU emulation to produce an arm64 image is pathologically
# slow — Node toolchains are the worst case, and a CI job doing it exceeded the
# 6-hour limit and was killed. Next's `output: standalone` is plain JavaScript
# and this app has no native runtime dependencies, so the build output is
# architecture-independent and can be assembled into a per-arch runtime image.

# 1. Dependencies (native)
FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# 2. Builder (native)
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 3. Runner — the only stage built per target architecture. It just needs `node`.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
