# SCAFFOLD_PROMPT.md

Paste everything below the line into Claude Code (plan mode first) at the root of an empty git repository that already contains the docs
(`AGENTS.md`, `CLAUDE.md`, `PRD.md`, `PERSONA.md`, `DESIGN.md`, `REVIEW.md`, `ARCHITECTURE.md`, `COMPLIANCE.md`, `CLEANROOM.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `docs/adr/0001-tech-stack.md`).

---

# ROLE

You are a senior staff engineer bootstrapping **OpenHR** (working name), an open-source (AGPL-3.0-or-later), self-hostable, multi-tenant HRIS for European SMBs, starting with Spain/Catalonia. You work in small, verified steps and never claim success you did not observe.

# FIRST, READ

Read in this order and obey the precedence stated in `AGENTS.md`: `AGENTS.md`, `CLEANROOM.md`, `COMPLIANCE.md`, `ARCHITECTURE.md`, `PRD.md`, `DESIGN.md`, `REVIEW.md`, `PERSONA.md`, `ROADMAP.md`, `docs/adr/0001-tech-stack.md`.
Do NOT browse or consult any commercial HR product, its docs, screenshots or code. Build only from the repository docs, public law, and generic domain knowledge.

# OBJECTIVE (Milestone M0 only)

Produce a **fully working, verified monorepo skeleton** - no feature logic beyond what is listed under "Vertical slice". Everything must install, build, lint, typecheck, test, and run with one command. Do not implement M1+ features.

# PROCESS (mandatory)

1. **Plan mode:** output a plan with the exact file tree, dependency list (name + purpose + license), and the order of steps. Wait for my approval. Flag any conflict between docs and any assumption.
2. After approval, implement in the phases below. After each phase run the stated verification commands and fix failures before continuing.
3. Commit after each phase using Conventional Commits with DCO sign-off (`git commit -s`).
4. At the end, produce the final report (see "Final report").
5. Ask before adding any dependency not listed here or changing a decision in ADR-0001.

# TOOLING DECISIONS (from ADR-0001; pin exact versions in lockfile)

Node.js current LTS (set in `.nvmrc` and `engines`), pnpm via corepack (`packageManager` field), Turborepo, TypeScript strict, ESLint (flat config) + Prettier, Vitest, fast-check, Testcontainers, Playwright + axe, Drizzle ORM + drizzle-kit, PostgreSQL (current supported major), pg-boss, Hono + `@hono/zod-openapi`, Zod, Better Auth (behind `AuthPort`), Next.js App Router, React, Tailwind CSS, shadcn/ui (Radix), lucide-react, next-intl, next-themes, React Email, Nodemailer, pino, Storybook, Husky + lint-staged + commitlint, changesets (or release-please), Renovate config.
Choose the latest stable versions at scaffold time; record versions and rationale in `docs/adr/0002-initial-dependencies.md`.

# TARGET REPOSITORY STRUCTURE

Create exactly this tree (files marked `(stub)` get minimal compilable content and a TODO linking to a PRD requirement ID; no empty directories - use `.gitkeep` only if unavoidable).

```
openhr/
├── .claude/
│   ├── settings.json                 # permissions: allow pnpm/git read cmds; deny reading .env*, infra/secrets/**, data/**
│   ├── commands/
│   │   ├── new-module.md             # /new-module <name>: scaffold feature across packages per ARCHITECTURE.md
│   │   ├── check.md                  # /check: run `pnpm verify`, summarize failures + fixes
│   │   └── clean-room-check.md       # /clean-room-check: scan diff, print attestation checklist
│   ├── agents/
│   │   ├── reviewer.md               # subagent: reviews diff using REVIEW.md, outputs its template
│   │   └── test-writer.md            # subagent: writes tests following AGENTS.md section 6
│   └── scratch/.gitignore            # ignore everything
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # install, typecheck, lint, unit, integration, i18n check, build, e2e (matrix: ubuntu)
│   │   ├── codeql.yml
│   │   ├── dependency-review.yml
│   │   ├── release.yml               # changesets/release-please + container build + SBOM (CycloneDX)
│   │   └── nightly-restore-test.yml  # (stub) backup/restore drill
│   ├── ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}
│   ├── PULL_REQUEST_TEMPLATE.md      # includes clean-room attestation from CLEANROOM.md section 5 + privacy/tenancy questions
│   ├── CODEOWNERS                    # two-approval areas per REVIEW.md section 4
│   ├── dependabot.yml or renovate.json
│   └── FUNDING.yml                   # (stub)
├── apps/
│   ├── web/                          # Next.js
│   │   ├── src/app/[locale]/(auth)/sign-in/page.tsx          # (stub) form wired to API
│   │   ├── src/app/[locale]/(app)/layout.tsx                 # app shell: sidebar/topbar/bottom nav per DESIGN.md
│   │   ├── src/app/[locale]/(app)/home/page.tsx              # shows /v1/me + health status
│   │   ├── src/app/[locale]/(app)/{people,time-off,time,documents,onboarding,reports,settings}/page.tsx  # (stub) EmptyState
│   │   ├── src/app/api/healthz/route.ts
│   │   ├── src/features/              # one folder per module, each with index.ts
│   │   ├── src/lib/{api-client.ts,auth.ts,format.ts}
│   │   ├── src/middleware.ts          # locale routing + CSP nonce + security headers
│   │   ├── public/{manifest.webmanifest,icons/}               # own placeholder icons
│   │   ├── next.config.ts, tailwind.config.ts, postcss.config.mjs, tsconfig.json, package.json
│   │   └── e2e/{smoke.spec.ts,a11y.spec.ts,playwright.config.ts}
│   ├── api/
│   │   ├── src/index.ts               # boot: env validation, migrations (advisory lock), server
│   │   ├── src/app.ts                 # Hono app factory (testable)
│   │   ├── src/env.ts                 # Zod env schema; supports *_FILE secrets
│   │   ├── src/middleware/{request-id,logger,security-headers,rate-limit,auth,tenant-context,error-handler}.ts
│   │   ├── src/policies/{index.ts,permissions.ts,can.ts}      # permission+scope model per ARCHITECTURE.md section 5
│   │   ├── src/routes/{health,me,auth,org}.ts                 # health, readiness, current user/org (real); others (stub)
│   │   ├── src/services/                                      # use cases (empty index.ts)
│   │   ├── src/ports/{auth,storage,mail,clock}.ts             # interfaces + local/dev adapters
│   │   ├── src/adapters/{better-auth,storage-local,mail-smtp,clock-system}.ts
│   │   ├── test/{health.int.test.ts,tenant-isolation.int.test.ts,auth.int.test.ts}
│   │   └── package.json, tsconfig.json, vitest.config.ts
│   └── worker/
│       ├── src/index.ts               # pg-boss boot, graceful shutdown
│       ├── src/queues/{email.send,leave.accrue,time.close-day,retention.enforce,audit.verify-chain}.ts   # handlers (stub) with idempotency helper
│       ├── src/lib/idempotency.ts
│       └── package.json, tsconfig.json, vitest.config.ts
├── packages/
│   ├── core/
│   │   ├── src/ports/clock.ts
│   │   ├── src/calendar/{working-days.ts,half-day.ts,holidays.ts,index.ts}   # real, tested
│   │   ├── src/leave/{ledger.ts,balance.ts,validate-request.ts,index.ts}      # types + ledger fold + balance (real, property-tested); accrual/policy (stub)
│   │   ├── src/time/{events.ts,fold-sessions.ts,hash-chain.ts,index.ts}       # event types, session folding, hash chain (real, tested)
│   │   ├── src/index.ts
│   │   └── test/*.test.ts (unit + fast-check), package.json, tsconfig.json
│   ├── db/
│   │   ├── src/schema/{platform,identity,people,leave,time,documents,lifecycle,audit,common}.ts
│   │   │                              # M0: real tables for organizations, legal_entities, locations, users, memberships, employees, employments,
│   │   │                              #     audit_log, time_events, leave_ledger; remaining tables declared as (stub) TODO with IDs
│   │   ├── src/rls/{policies.sql.ts,helpers.ts}               # generate ENABLE/FORCE RLS + policies for every table with organization_id
│   │   ├── src/with-tenant.ts         # withTenant(ctx, fn): SET LOCAL app.current_org / app.current_user in a transaction
│   │   ├── src/repositories/          # require Tx from withTenant (type-level)
│   │   ├── src/crypto/envelope.ts     # AES-256-GCM envelope encryption helpers + key id (tested)
│   │   ├── migrations/                # generated + hand-edited SQL (roles, RLS, append-only triggers, exclusion constraints)
│   │   ├── seeds/{dev.ts,holidays-es.ts}                      # dev org with admin/manager/employee; ES national holidays 2026-2027 + Catalunya
│   │   ├── test/{rls-isolation.int.test.ts,append-only.int.test.ts,exclusion-constraints.int.test.ts}
│   │   └── drizzle.config.ts, package.json, tsconfig.json
│   ├── contracts/
│   │   ├── src/{common,errors,auth,org,employees,leave,time,documents}.ts   # Zod schemas; M0 real: common, errors, auth, org, me
│   │   ├── src/permissions.ts         # permission names + scopes (source of truth)
│   │   ├── scripts/generate-openapi.ts
│   │   └── generated/                 # OpenAPI JSON + typed client (committed or generated in CI; do not hand edit)
│   ├── ui/
│   │   ├── src/tokens.css             # semantic tokens light/dark per DESIGN.md
│   │   ├── src/components/            # Button, Input, Select, Checkbox, Switch, Dialog, Sheet, Tooltip, Toast, Badge/StatusPill, Avatar,
│   │   │                              #   Skeleton, EmptyState, ErrorState, DataTable (basic), Tabs, Sidebar, Topbar, BottomNav, ConfirmDialog, SecretField
│   │   ├── src/lib/cn.ts
│   │   ├── .storybook/                # config + a11y addon
│   │   └── stories/*.stories.tsx, package.json, tsconfig.json
│   ├── i18n/
│   │   ├── messages/{en,es,ca}.json   # ICU messages; namespaces: common, auth, nav, errors, home
│   │   ├── src/{config.ts,check.ts}   # locales, key-diff script that fails CI on missing/extra keys
│   │   └── package.json
│   ├── emails/
│   │   ├── src/templates/{invite.tsx,password-reset.tsx}      # ca/es/en via i18n; plain-text fallbacks; no tracking pixels
│   │   └── package.json
│   ├── config/
│   │   ├── tsconfig/{base.json,node.json,next.json,react-library.json}
│   │   ├── eslint/{base.js,next.js,node.js}                   # includes import-boundary rules (see below)
│   │   ├── prettier/index.js
│   │   └── tailwind/preset.ts
│   └── testing/
│       ├── src/{factories.ts,containers.ts,clock.ts,tenant.ts}  # org/user/employee factories, Postgres Testcontainer, FakeClock, tenant helper
│       └── package.json
├── infra/
│   ├── docker/{web.Dockerfile,api.Dockerfile,worker.Dockerfile}  # multi-stage, non-root, healthchecks
│   ├── compose/{docker-compose.yml,docker-compose.dev.yml,Caddyfile.example}
│   ├── env/.env.example               # every variable documented with comments and safe defaults
│   ├── postgres/init/{00-roles.sql}   # owner role, app role (NOBYPASSRLS), grants
│   └── scripts/{doctor.ts,backup.sh,restore.sh}               # `pnpm doctor`: checks env, db, migrations, RLS enabled on all tenant tables
├── docs/
│   ├── adr/{0001-tech-stack.md,0002-initial-dependencies.md,0003-multi-tenancy-rls.md}
│   ├── compliance/{ropa-template.md,dpia-template.md,breach-runbook.md,changelog.md}
│   ├── guides/{self-hosting.md,backup-restore.md,upgrading.md,development.md,translations.md,adding-a-holiday-calendar.md}
│   └── index.md
├── AGENTS.md  CLAUDE.md  PRD.md  PERSONA.md  DESIGN.md  REVIEW.md  ARCHITECTURE.md  COMPLIANCE.md  CLEANROOM.md  CONTRIBUTING.md  ROADMAP.md
├── CODE_OF_CONDUCT.md   SECURITY.md   NOTICE   LICENSE (AGPL-3.0-or-later full text)   CHANGELOG.md   README.md
├── .editorconfig  .gitignore  .gitattributes  .nvmrc  .npmrc  .env.example (-> infra/env/.env.example)  .dockerignore
├── commitlint.config.cjs  lint-staged.config.mjs  .husky/{pre-commit,commit-msg}
├── turbo.json  pnpm-workspace.yaml  package.json  tsconfig.json
└── renovate.json (or .github/dependabot.yml)
```

# PHASES

## Phase 1 - Workspace and tooling

- Create workspace files, shared configs, scripts in root `package.json` exactly matching the commands table in `AGENTS.md` section 3 (`dev`, `infra:up`, `db:*`, `typecheck`, `lint`, `format`, `test`, `test:int`, `test:e2e`, `verify`, `contracts:generate`, `i18n:check`, `doctor`).
- ESLint import-boundary rules enforcing the dependency direction in `AGENTS.md` section 2 (`core` imports nothing internal; `web` cannot import `db`/`api`; etc.). Add a lint test proving a violation fails.
- `verify` = typecheck + lint + unit + integration + i18n check + build.
- Husky hooks: pre-commit (lint-staged), commit-msg (commitlint + require `Signed-off-by`).
  **Verify:** `pnpm install && pnpm typecheck && pnpm lint` pass on the empty skeleton.

## Phase 2 - Database, RLS, tenancy harness

- Implement real tables listed in `packages/db` (M0 subset) with `id uuid` (UUIDv7), timestamps, `organization_id` where applicable, indexes, and constraints (exclusion constraint on overlapping `employments`; append-only trigger + REVOKE on `time_events`, `audit_log`, `leave_ledger`).
- `infra/postgres/init/00-roles.sql`: owner role (migrations) and `openhr_app` role (`NOSUPERUSER NOBYPASSRLS`).
- `rls/policies.sql.ts` programmatically enables + forces RLS and creates policies for **every** table that has `organization_id`; a test fails if a tenant table lacks RLS.
- `withTenant` helper; repositories only accept the transaction type it produces.
- `rls-isolation.int.test.ts`: for each tenant table, create two orgs, prove org A cannot select/insert/update/delete org B rows, including via joins.
- Seeds: dev org, three users (admin/manager/employee), ES national + Catalunya holidays for 2026-2027.
  **Verify:** `pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm test:int` (db package) pass.

## Phase 3 - Core domain (pure)

- `calendar`: working-day computation with weekends, holidays, half-days, per-location calendars; Temporal (polyfill) used internally; no `Date` arithmetic.
- `leave`: ledger entry types, fold to balance, validate request (overlap, insufficient balance) - accrual policy functions are stubs.
- `time`: event types, `foldSessions`, hash chain (`sha256(prev_hash || canonical_json)`), verify function; rest-period and overtime are stubs.
- Property tests: balance == sum(ledger); sessions never overlap; chain verification detects any tampering; DST-change day and leap-day fixtures.
  **Verify:** `pnpm --filter @openhr/core test` passes with coverage >= 90% on implemented code.

## Phase 4 - Contracts and API

- Zod contracts for common types, problem+json errors, auth, org, `GET /v1/me`.
- Hono app with the middleware pipeline from `ARCHITECTURE.md` section 3.2; `/healthz`, `/readyz`, `/v1/me`, `/v1/org`, `/v1/openapi.json`.
- Auth via Better Auth behind `AuthPort`: email+password, email verification (Mailpit in dev), sessions, invitations (stub), org membership. Rate limit auth endpoints.
- Permission + scope model in `contracts/permissions.ts` and `policies/can.ts` with unit tests (self vs reports vs department vs organization).
- Integration tests: auth flow, unauthorized/forbidden, cross-tenant 404, problem+json shape.
- Generate OpenAPI + typed client (`pnpm contracts:generate`); CI fails if generated output is stale.
  **Verify:** `pnpm --filter @openhr/api test:int` and `pnpm contracts:generate && git diff --exit-code`.

## Phase 5 - Worker

- pg-boss boot, graceful shutdown, health reporting; queues registered with idempotent handler skeleton; `email.send` real via `MailPort` + React Email invite/reset templates; others (stub) with TODO + requirement IDs.
  **Verify:** integration test enqueues `email.send` and observes the message in Mailpit (or a fake `MailPort`).

## Phase 6 - Design system and web shell

- Implement `tokens.css` (light/dark) from `DESIGN.md`; self-hosted font; Tailwind preset; the components listed with Storybook stories and a11y checks.
- Next.js app: locale routing (`ca`, `es`, `en`), app shell (sidebar desktop, bottom nav mobile), sign-in page wired to API, home page showing current user/org and API health, stub pages using `EmptyState`, theme switch, language switch, PWA manifest, security headers + CSP nonce middleware.
- i18n: messages for all three locales; `pnpm i18n:check` fails on missing/extra keys.
- No third-party runtime requests anywhere (verify with a Playwright network assertion).
  **Verify:** `pnpm --filter web build`, Storybook builds, Playwright smoke + axe pass at 360 px and 1280 px.

## Phase 7 - Docker, CI, docs

- Multi-stage Dockerfiles (non-root, healthchecks); `docker compose up` brings up postgres, api, worker, web, mailpit; Caddy example for TLS.
- `pnpm doctor` validates env, DB connectivity, migrations applied, RLS forced on all tenant tables, app role has no `BYPASSRLS`.
- CI workflows as listed; cache pnpm/turbo; run integration tests with service containers or Testcontainers.
- README: what/why, screenshot placeholder, quick start (<10 min), architecture diagram, license, links to docs. Fill `docs/guides/*` with accurate, tested instructions. `NOTICE` lists third-party licenses via an automated script.
  **Verify:** from a clean clone: `corepack enable && pnpm install && pnpm verify`; and `docker compose -f infra/compose/docker-compose.yml up --build` reaches healthy state; sign in as seeded admin.

# VERTICAL SLICE (acceptance for M0)

A seeded admin can open the web app in Catalan, sign in, see the app shell with their organization name from `/v1/org`, switch to Spanish/English and dark mode, and see API health. A second org's data is provably invisible (tests). CI is green.

# CONSTRAINTS

- Follow `AGENTS.md` fully (strict TS, Zod at boundaries, no `any`, no PII in logs, no third-party runtime assets, DCO sign-off).
- Every `(stub)` has a `// TODO(<PRD-ID>): ...` and appears in a generated `docs/stubs.md` list (script `pnpm stubs:list`).
- Do not add telemetry, analytics, or network calls beyond the local stack.
- Use only original assets and copy; placeholder logo/icons are our own simple shapes. Do not name or imitate any commercial HR product.
- Keep each PR/commit under ~500 lines excluding lockfile and generated files; split phases into multiple commits.
- Do not read or write `.env*` with real secrets; use `infra/env/.env.example` values.
- If a requirement is ambiguous, stop and ask one precise question.

# CLAUDE CODE CONFIG TO CREATE

- `.claude/settings.json`: allow `pnpm *`, `git status|diff|log|add|commit`, `docker compose *`; deny reading `.env*`, `infra/secrets/**`, `data/**`; hooks: after file edits run `pnpm prettier --write` on changed files; before `git commit` run `pnpm lint-staged`.
- `.claude/agents/reviewer.md`: description "Reviews the current diff against REVIEW.md"; tools read/grep/bash(read-only + test commands); must output the template in REVIEW.md section 5; must never approve without running `pnpm verify`.
- `.claude/agents/test-writer.md`: writes tests per AGENTS.md section 6 for a given path; must include failure and cross-tenant cases.
- `.claude/commands/new-module.md`: given `$ARGUMENTS` (module name + PRD prefix), create contracts, db schema stub, repository, service, route, web feature folder, i18n keys (ca/es/en), tests, and a PRD cross-reference; then run `pnpm verify`.

# FINAL REPORT (print at the end)

1. Summary of what was built per phase with commit hashes.
2. Exact commands run for verification and their pass/fail results (no claims without output).
3. List of stubs (`pnpm stubs:list`) mapped to PRD IDs and the milestone that owns them.
4. Decisions/assumptions made, deviations from the docs, and doc updates proposed.
5. Risks and open questions (including: project name and trademark, holiday data sources, Better Auth fit, PWA offline clock design).
6. Recommended first three issues for M1.
