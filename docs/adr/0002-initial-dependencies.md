# ADR 0002: Initial Dependencies and Licensing Audit

## Status

Accepted

## Date

2026-11-01

## Context

Milestone M0 requires setting up a verified monorepo skeleton for OpenHR under the AGPL-3.0-or-later license. To preserve licensing integrity and prevent future legal encumbrances, all dependencies must be reviewed for compatibility with AGPL-3.0, verified to contain no telemetry or tracking, actively maintained, and pinned in the lockfile.

## Decision

We adopt the following core dependencies:

| Package                | Version       | Purpose                           | License    | Rationale                                                             |
| ---------------------- | ------------- | --------------------------------- | ---------- | --------------------------------------------------------------------- |
| `node`                 | 22.x LTS      | Runtime platform                  | MIT        | Long Term Support, native fetch, crypto, Web Streams                  |
| `pnpm`                 | 10.5.2        | Package manager                   | MIT        | Strict monorepo isolation, fast linking, corepack support             |
| `turbo`                | 2.11.x        | Monorepo build orchestrator       | Apache-2.0 | High performance caching and dependency graph pipeline                |
| `typescript`           | 5.7.x         | Static typing                     | Apache-2.0 | Strict type safety, exact optional property checking                  |
| `hono`                 | 4.7.x         | API Framework                     | MIT        | Ultra-fast, lightweight, web-standard compliant, zero-runtime bloat   |
| `@hono/zod-openapi`    | 1.x           | OpenAPI contract generation       | MIT        | Type-safe schema validation and documentation generation              |
| `drizzle-orm`          | 0.39.x        | Database ORM                      | Apache-2.0 | SQL-first, zero-overhead TypeScript ORM with full RLS policy support  |
| `postgres`             | 3.4.x         | PostgreSQL driver                 | MIT        | Fastest modern pure JS/TS driver, pipeline support                    |
| `pg-boss`              | 10.1.x        | Background job queue              | MIT        | Reliable job queues directly backed by PostgreSQL                     |
| `next`                 | 15.1.x        | Frontend framework                | MIT        | Server components, App Router, asset self-hosting                     |
| `react`                | 19.0.x        | UI library                        | MIT        | Standard component model, actions, compiler integration               |
| `tailwindcss`          | 3.4.x         | Utility-first CSS                 | MIT        | Token-based theming via CSS variables without runtime overhead        |
| `radix-ui`             | 1.1.x / 2.1.x | Headless accessible UI primitives | MIT        | Unstyled, WCAG 2.2 AA compliant accessible foundations                |
| `lucide-react`         | 0.475.x       | Iconography                       | ISC        | Clean, consistent, tree-shakeable icons                               |
| `next-intl`            | 3.26.x        | Internationalization              | MIT        | App Router native ICU messaging, routing, locale detection            |
| `next-themes`          | 0.4.x         | Theme switching                   | MIT        | Zero-FOUC light, dark, and system preference support                  |
| `@react-email/*`       | 3.0.x         | Transactional email templates     | MIT        | React-based email authoring with text fallback                        |
| `nodemailer`           | 6.10.x        | SMTP email transport              | MIT-0      | Dependable SMTP transport for self-hosted mail gateways               |
| `pino`                 | 9.6.x         | Structured logging                | MIT        | High-performance JSON logging with PII redact hooks                   |
| `temporal-polyfill`    | 0.2.5         | Temporal API polyfill             | MIT        | ISO 8601 calendar and date calculations without `Date` traps          |
| `vitest`               | 3.0.x         | Test runner                       | MIT        | Fast ESM native unit and integration test runner                      |
| `fast-check`           | 3.23.x        | Property-based testing            | MIT        | Generative testing for leave ledger invariants and calendars          |
| `testcontainers`       | 10.18.x       | Containerized integration tests   | MIT        | Automated ephemeral Docker PostgreSQL containers                      |
| `@playwright/test`     | 1.50.x        | End-to-end browser testing        | Apache-2.0 | Headless browser testing for happy/failure flows and mobile viewports |
| `@axe-core/playwright` | 4.10.x        | Accessibility auditing            | MPL-2.0    | Automated WCAG 2.2 AA accessibility violations scanner                |

## Consequences

- Every direct and transitive dependency is compatible with the AGPL-3.0 license.
- No third-party network calls, external fonts, or analytics libraries are loaded at runtime.
- Upgrades will be tracked and kept current via Renovate / Dependabot.
