# Multi-stage Dockerfile for Next.js web frontend
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time;
# setting them when the container starts has no effect. Empty (the default)
# makes the browser call the API on its own origin (/v1/...), which is what
# the bundled Caddyfile routes to the API. Set it only when the API is served
# from a different origin, and rebuild the image whenever it changes.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/next.config.ts ./apps/web/next.config.ts

EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/healthz || exit 1

CMD ["pnpm", "--filter", "web", "start"]
