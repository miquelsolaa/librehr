# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) and human contributors working in this repository.
Project name: **LibreHR** (formerly OpenHR).

> Read order for any non-trivial task: `AGENTS.md` -> `PRD.md` -> `ARCHITECTURE.md` -> the doc relevant to your area
> (`DESIGN.md`, `COMPLIANCE.md`, `REVIEW.md`). If these conflict, the order of precedence is:
> `CLEANROOM.md` > `COMPLIANCE.md` > `AGENTS.md` > `ARCHITECTURE.md` > `PRD.md` > `DESIGN.md`.

## 1. Project snapshot

LibreHR is an open-source (AGPL-3.0), self-hostable Human Resources Information System for European SMBs, starting with Spain.
Core modules: employees and org structure, time off, time tracking (jornada), documents, onboarding/offboarding, reports/exports.
It is multi-tenant ready (many organizations per instance) and single-tenant friendly (one `docker compose up`).

## 2. Repository map

```
apps/web        Next.js (App Router) frontend. No business logic beyond presentation.
apps/api        Hono REST API (OpenAPI). Auth, authorization, orchestration.
apps/worker     pg-boss background jobs (emails, accruals, reminders, exports, retention).
packages/core   Pure TypeScript domain logic (leave accrual, working-time maths, calendars). No I/O.
packages/db     Drizzle schema, migrations, RLS policies, seeds, repositories.
packages/contracts  Zod schemas + inferred types shared by api and web. Source of truth for request/response shapes.
packages/ui     Design system components (shadcn/ui based), tokens, Storybook.
packages/i18n   Message catalogs (ca, es, en) and helpers.
packages/emails React Email templates.
packages/config Shared tsconfig, eslint, prettier, tailwind preset.
packages/testing  Factories, fixtures, Testcontainers helpers.
infra/          Dockerfiles, compose files, example env, reverse-proxy samples.
docs/           ADRs, how-tos, user docs.
```

Dependency direction (enforced by lint): `web -> contracts, ui, i18n` · `api -> core, db, contracts` · `worker -> core, db, emails` · `core -> (nothing internal)`.
`core` must never import `db`, `api`, `web`, or any I/O library.

## 3. Commands

Use `pnpm` (via corepack). Never use npm or yarn.

| Task                                                 | Command                                              |
| ---------------------------------------------------- | ---------------------------------------------------- |
| Install                                              | `pnpm install`                                       |
| Start everything (db + api + web + worker + mailpit) | `pnpm dev`                                           |
| Start only infra (Postgres, Mailpit, MinIO)          | `pnpm infra:up`                                      |
| Migrate / reset / seed DB                            | `pnpm db:migrate` · `pnpm db:reset` · `pnpm db:seed` |
| Generate a migration from schema changes             | `pnpm db:generate`                                   |
| Typecheck                                            | `pnpm typecheck`                                     |
| Lint / format                                        | `pnpm lint` · `pnpm format`                          |
| Unit tests                                           | `pnpm test`                                          |
| Integration tests (Testcontainers)                   | `pnpm test:int`                                      |
| E2E (Playwright)                                     | `pnpm test:e2e`                                      |
| Everything CI runs                                   | `pnpm verify`                                        |
| Regenerate OpenAPI + API client                      | `pnpm contracts:generate`                            |
| Extract / check i18n keys                            | `pnpm i18n:check`                                    |

**Before declaring any task done, run `pnpm verify` and fix every failure.** If you cannot run it, say so explicitly.

## 4. Coding conventions

- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`; use `unknown` + narrowing. No `// @ts-ignore` (use `@ts-expect-error` with a reason).
- Validate **every** boundary with Zod (HTTP input, env vars, job payloads, webhooks). Types are inferred from schemas, not hand-written twice.
- Prefer pure functions and explicit data over classes. Domain logic lives in `packages/core` and is unit-tested without a database.
- Errors: throw typed `AppError` subclasses (`NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`). The API maps them to RFC 9457 `application/problem+json`. Never leak stack traces or internal ids to clients.
- No default exports except where a framework requires them (Next.js pages/layouts).
- File names `kebab-case.ts`; React components `PascalCase` exports in kebab-case files. One concept per file; keep files under ~300 lines.
- Comments explain _why_, not _what_. Public functions in `core` get TSDoc with an example.
- Do not add a dependency without checking: license is compatible with AGPL-3.0, actively maintained, no telemetry, and justified in the PR description.
- No `console.log` in committed code; use the `logger` (pino) with structured fields. Never log PII (names, emails, DNI/NIE, IBAN, health or absence reasons).

## 5. Domain rules that are easy to get wrong

- **Time**: store instants as `timestamptz` (UTC). Store calendar concepts (leave days, holidays, birthdays) as `date` in the **organization's or location's time zone**, never as UTC midnights. Do business-date arithmetic with Temporal (polyfill) or `date-fns-tz` inside `packages/core` only. No `new Date()` arithmetic in business logic.
- **Time off**: balances are derived from an append-only `leave_ledger`; never mutate a balance column directly. Half days are first-class. Holidays are per location calendar. All policy numbers (days per year, carry-over, accrual) are **configuration, never constants**.
- **Time tracking**: `time_events` is append-only. Corrections are new events that reference the original; nothing is updated or deleted. Every row carries actor, source, reason (when corrected), and a hash chain for tamper evidence.
- **Tenancy**: every table that holds tenant data has `organization_id` and a Postgres RLS policy. Every request sets `app.current_org` and `app.current_user` inside the transaction. A query that works without RLS context is a bug.
- **Authorization**: check permission **and** scope (self / direct reports / department / organization). Authorization lives in `apps/api` policy functions, never in the frontend alone.
- **Sensitive data**: absence reasons, medical leave, disability, union membership, and similar are special-category data. Do not store diagnoses. Absence types are coarse (`sick`, `maternity`, ...). See `COMPLIANCE.md`.
- **Money/payroll**: MVP does not compute payroll. Do not add salary calculation. Salary fields, if present, are encrypted at rest and visible only to explicit roles.

## 6. Testing rules

- New domain logic in `core` requires unit tests, including edge cases (year boundaries, DST changes, half days, leap years, part-time contracts). Use property-based tests (`fast-check`) for accrual and balance invariants.
- New endpoints require an integration test covering success, validation failure, unauthorized, forbidden, and cross-tenant access (must return 404/403, never data).
- New UI flows that change data require a Playwright test for the happy path and one failure path. Run an axe accessibility check on every new page.
- Bug fixes start with a failing test that reproduces the bug.
- No snapshot tests for large DOM trees. No sleeping in tests; wait on conditions.

## 7. Git and PR workflow

- Trunk-based. Branch from `main`: `feat/<scope>-<short>`, `fix/...`, `chore/...`, `docs/...`.
- Conventional Commits (`feat(leave): ...`). Sign off every commit (`git commit -s`, DCO).
- Small PRs (< ~500 changed lines excluding generated files and lockfile). One logical change per PR.
- Fill the PR template, including the **clean-room attestation**.
- Never commit secrets, `.env` files, real personal data, production dumps, or screenshots of third-party products.
- Never force-push to `main`. Never rewrite published history.

## 8. Boundaries

**Always**

- Read the relevant requirement ID in `PRD.md` and reference it in commits/PRs (e.g. `LEA-012`).
- Add or update tests, i18n keys (all three locales), and docs in the same PR as the code.
- Keep migrations forward-only and safe to run on a populated database.
- Ask whether a change affects privacy, authorization, or tenancy; if yes, say so in the PR.

**Ask first (stop and request human confirmation)**

- Adding or replacing a major dependency, or changing the stack decided in `docs/adr/`.
- Changing database schema for existing tables in a non-additive way.
- Anything touching auth, session handling, RLS policies, encryption, or audit logging.
- Adding any outbound network call, telemetry, analytics, or third-party service.
- Changing a legal/compliance default (retention periods, working-time rules).

**Never**

- Copy code, text, copy-writing, icons, layouts, or data from any commercial HR product or its repositories, docs, or apps. See `CLEANROOM.md`.
- Scrape, automate, or reverse-engineer any third-party product, or use credentials that are not ours.
- Disable RLS, bypass authorization, or add "temporary" backdoors, debug admin accounts, or hard-coded secrets.
- Store plaintext secrets or sensitive personal data in logs, analytics, error messages, or test fixtures.
- Introduce Google Fonts/CDNs or any third-party asset loaded at runtime (privacy: no IP leakage). Self-host assets.
- Mark work as done without running `pnpm verify`.

## 9. Definition of done

1. Acceptance criteria of the referenced PRD requirement are met.
2. `pnpm verify` passes (typecheck, lint, unit, integration, i18n check, build).
3. Tests added for success and failure paths, including cross-tenant access where relevant.
4. UI: keyboard accessible, axe clean, responsive from 360 px, all strings translated (ca/es/en).
5. Docs updated (`docs/`, OpenAPI regenerated, ADR if a decision was made).
6. No new lint suppressions without justification. No TODOs without an issue link.
7. PR description lists: what changed, why, how it was tested, risks, and the clean-room attestation.

## 10. When you are unsure

Prefer asking one precise question over guessing. If you must proceed, state your assumption in the PR description and keep the change reversible.
Surface conflicts between documents instead of silently picking one.
