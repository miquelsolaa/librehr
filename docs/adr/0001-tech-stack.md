# ADR-0001: Technology stack

- Status: Proposed (accept after M0 spike)
- Date: 2026-11-01
- Deciders: Maintainers

## Context

We need a self-hostable, multi-tenant HRIS with strong correctness around dates/time, simple operations, and an approachable codebase for contributors and AI agents. Team strength: TypeScript/Next.js, Supabase/Postgres, n8n-style automation.

## Decision

- **Language/runtime:** TypeScript (strict) on the current Node.js LTS. pnpm workspaces + Turborepo.
- **Database:** PostgreSQL (current major minus none; supported versions per Postgres policy) with Row Level Security. Drizzle ORM + SQL migrations.
- **Queue/scheduler:** pg-boss on Postgres (no Redis).
- **API:** Hono + Zod (OpenAPI generation), separate from the web app.
- **Web:** Next.js App Router, React, Tailwind, shadcn/ui, next-intl, PWA.
- **Auth:** Better Auth behind an `AuthPort`.
- **Storage:** local filesystem or S3-compatible (MinIO) behind `StoragePort`.
- **Email:** SMTP via Nodemailer; React Email templates.
- **Testing:** Vitest, fast-check, Testcontainers, Playwright, axe.
- **Observability:** pino, optional OpenTelemetry, Prometheus metrics.
- **License:** AGPL-3.0-or-later; DCO for contributions.

## Alternatives considered

- **Supabase as backend:** fast start, but couples self-hosting to a larger stack and weakens portability of auth/storage; revisit for a hosted offering.
- **NestJS API:** strong structure but heavier; Hono + explicit modules is lighter and sufficient.
- **Next.js only (server actions):** fewer deployables, but weaker public API story, worker separation, and boundaries for agents/contributors.
- **Redis + BullMQ:** more features, extra infrastructure; pg-boss covers needs at SMB scale.
- **Prisma:** good DX, but RLS/transaction-scoped context and raw SQL control are simpler with Drizzle.
- **MIT/Apache license:** more permissive, allows closed SaaS forks; AGPL chosen to keep network-hosted derivatives open.

## Consequences

- Two deployables plus a worker (web, api, worker) but one database; simple compose file.
- RLS discipline is mandatory; repository APIs force tenant context.
- We own more auth/authorization policy code; mitigated by `AuthPort` and tests.
- Revisit this ADR after the M0 spike (auth, RLS harness, DX) and at M3 (time-tracking performance).
