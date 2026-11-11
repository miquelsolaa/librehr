# Multi-stage Dockerfile for @librehr/api
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @librehr/api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 librehr
USER librehr

COPY --from=builder --chown=librehr:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=librehr:nodejs /app/packages ./packages
COPY --from=builder --chown=librehr:nodejs /app/apps/api ./apps/api

EXPOSE 3001
ENV PORT=3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/healthz || exit 1

CMD ["node", "apps/api/dist/index.js"]
