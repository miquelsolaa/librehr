# Multi-stage Dockerfile for @librehr/api
#
# EDITION=community (default) builds the AGPL image: ee/ is not copied in, and
# the API runs as the Community edition. EDITION=business adds ee/ (LibreHR
# Enterprise License); it only unlocks features with a valid licence key.
#   docker build -f infra/docker/api.Dockerfile --build-arg EDITION=business .
ARG EDITION=community
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

FROM base AS source-community
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# Present in both editions so the runner can copy it; empty in Community.
RUN mkdir -p ee

FROM source-community AS source-business
COPY ee ./ee

FROM source-${EDITION} AS builder
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @librehr/api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 librehr
USER librehr

COPY --from=builder --chown=librehr:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=librehr:nodejs /app/packages ./packages
COPY --from=builder --chown=librehr:nodejs /app/ee ./ee
COPY --from=builder --chown=librehr:nodejs /app/apps/api ./apps/api

EXPOSE 3001
ENV PORT=3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/healthz || exit 1

CMD ["node", "apps/api/dist/index.js"]
