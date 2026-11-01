# Local Development Guide

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 9.0.0 (via `corepack enable`)
- Docker & Docker Compose (optional, for local postgres/mailpit/minio)

## Getting Started

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Start developer infra (Postgres, Mailpit, MinIO):**

   ```bash
   pnpm infra:up
   ```

3. **Migrate and seed database:**

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

4. **Start all dev servers:**
   ```bash
   pnpm dev
   ```
   - Web application: `http://localhost:3000`
   - REST API: `http://localhost:3001`
   - OpenAPI Docs: `http://localhost:3001/v1/openapi.json`
   - Mailpit Web UI: `http://localhost:8025`

## Verification Pipeline

Before committing any changes, run:

```bash
pnpm verify
```

This runs typecheck, lint, unit tests, integration tests, i18n key consistency checks, and production builds across all packages.
