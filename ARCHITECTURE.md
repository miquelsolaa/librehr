# ARCHITECTURE.md

Technical blueprint for LibreHR. Decisions and trade-offs are recorded in `docs/adr/`. If code and this document diverge, fix one of them in the same PR.

## 1. Goals that shape the architecture

Self-hostable with minimal moving parts · tenant isolation by construction · correctness of dates/leave/time · auditability · contributor-friendly · boring, widely-known technology.

## 2. System overview

```
                      +-------------------+
 Browser / PWA  --->  |   apps/web        |  Next.js (App Router), RSC + client islands
                      +---------+---------+
                                | typed client (generated from contracts/OpenAPI)
                                v
                      +-------------------+        +------------------+
                      |   apps/api        | -----> |  Object storage  |  (local FS or S3/MinIO)
                      |   Hono REST       |        +------------------+
                      |   authn/authz     |
                      +----+---------+----+        +------------------+
                           |         |       ----> |  SMTP server     |
                           v         v             +------------------+
              +----------------+   +----------------+
              | packages/core  |   | packages/db    |  Drizzle + SQL migrations + RLS
              | pure domain    |   +--------+-------+
              +----------------+            |
                                            v
                                   +------------------+
                                   |   PostgreSQL     |  data + job queue (pg-boss) + RLS
                                   +--------+---------+
                                            ^
                                   +--------+---------+
                                   |  apps/worker     |  emails, accruals, reminders, exports, retention
                                   +------------------+
```

Only Postgres is stateful besides object storage. No Redis, no message broker, no search engine in v1.0.

## 3. Components

### 3.1 apps/web (Next.js)

- App Router; server components fetch data through the typed API client with the user's session; client components only for interactivity (forms, calendars, clock widget).
- i18n with `next-intl` (locale in URL prefix `/ca`, `/es`, `/en`); per-user locale preference overrides.
- PWA: manifest, service worker for offline shell and queued clock events (see 7.3), web push (later).
- No business rules in the web app. It formats, validates for UX (shared Zod), and calls the API.
- Security headers via middleware: CSP (no inline scripts, nonces), HSTS, frame-ancestors none, referrer-policy, permissions-policy.

### 3.2 apps/api (Hono)

- Routes grouped by module: `/v1/auth`, `/v1/org`, `/v1/employees`, `/v1/leave`, `/v1/time`, `/v1/documents`, `/v1/onboarding`, `/v1/admin`, `/v1/reports`.
- Request pipeline: request-id -> logger -> security headers -> rate limit -> session/token auth -> tenant context -> permission+scope policy -> validation (Zod) -> handler -> response schema -> problem+json error mapper.
- Handlers are thin: parse, authorize, call a **service** (use case) that orchestrates `core` + `db`, return DTO.
- OpenAPI generated from route contracts; served at `/v1/openapi.json` and rendered in docs.
- Auth library: Better Auth (self-hosted, DB-backed sessions, organizations, 2FA, OIDC) behind our own `AuthPort` interface so it can be swapped.

### 3.3 apps/worker (pg-boss)

Queues: `email.send`, `leave.accrue` (scheduled daily per org time zone), `leave.expire-carryover`, `time.close-day` (detect missing clock-outs), `reminders.*`, `export.generate`, `retention.enforce`, `documents.scan`, `audit.verify-chain`.
Jobs are idempotent (idempotency key = natural key + date), retried with exponential backoff, and visible via an admin "Jobs" page (read-only).

### 3.4 packages/core (domain)

Pure TypeScript, no I/O, injected `Clock`. Modules: `calendar` (working days, holidays, half days), `leave` (accrual, ledger, balance, validation, overlap), `time` (events fold into sessions, rest/overtime rules, timesheets), `schedule`, `retention`. 100% unit-testable; property-based tests for invariants (balance equals sum of ledger; no overlapping sessions; accrual monotonic).

### 3.5 packages/db

Drizzle schema (`schema/*.ts`), SQL migrations (generated + hand-edited for RLS/triggers), RLS policy definitions, seed scripts, and repositories that **require a transaction-scoped tenant context** (type-level: repository functions take `Tx`, obtained only via `withTenant(ctx, fn)`).

### 3.6 packages/contracts

Zod schemas for all requests/responses/events, error codes, and permission names. Generates OpenAPI and the typed client (`pnpm contracts:generate`). Breaking changes require a version bump of the affected route.

## 4. Multi-tenancy and RLS

- Shared database, shared schema. Every tenant table: `organization_id uuid not null`, indexed, part of composite FKs where relevant.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` Policies: `USING (organization_id = current_setting('app.current_org')::uuid)` and same `WITH CHECK`.
- The application connects as a non-superuser role without `BYPASSRLS`. Migrations run with a separate owner role.
- `withTenant({ orgId, userId, role }, fn)` opens a transaction and executes `SET LOCAL app.current_org = ...; SET LOCAL app.current_user = ...`.
- Worker jobs carry `orgId` in their payload and use the same `withTenant`. Cross-org maintenance jobs iterate organizations explicitly.
- Instance super-admin operates on a separate `platform` schema (organizations list, plans, health) and has no policy access to tenant tables.
- Tests: for every table, a generated test asserts that org A cannot select/insert/update/delete org B rows.

## 5. Authentication and authorization

- Sessions: HTTP-only, Secure, SameSite=Lax cookies; rotation on privilege change; device list and revocation. Personal access tokens for API (hashed, scoped, expiring).
- RBAC with scopes: permission strings like `leave.request.approve`, with scope `self | reports | department | location | organization`. Roles are bundles of (permission, scope).
- Policy functions live in `apps/api/src/policies/*` and are unit-tested; handlers call `can(ctx, permission, resource)`; list queries apply scope filters in SQL, not after fetching.
- Sensitive-field access requires explicit permission and writes an audit entry.

## 6. Data model (overview)

Naming: snake_case tables/columns, plural table names, `id uuid` (UUIDv7), `created_at/updated_at timestamptz`, `deleted_at` for soft delete where retention requires.

Platform: `organizations`, `legal_entities`, `locations`.
Identity: `users` (auth identity), `sessions`, `memberships` (user<->org with role), `invitations`, `api_tokens`.
People: `employees` (person record), `employments` (period rows: title, department, manager, location, type, start/end, schedule_id), `departments`, `teams`, `team_members`, `custom_field_defs`, `custom_field_values`, `emergency_contacts`.
Leave: `leave_types`, `leave_policies`, `leave_policy_assignments`, `holiday_calendars`, `holidays`, `leave_requests` (status machine), `leave_request_days` (materialized per-day rows incl. half days), `leave_ledger` (append-only: accrual/usage/adjustment/carryover/expiry, with `source_ref`).
Time: `schedules` (+ `schedule_rules`), `time_events` (append-only: `clock_in|clock_out|break_start|break_end|correction`, `employee_id`, `occurred_at`, `recorded_at`, `source`, `actor_id`, `ref_event_id`, `reason`, `prev_hash`, `hash`), `time_correction_requests`, `time_exports`, `timesheet_closures`.
Documents: `documents`, `document_versions`, `document_folders`, `document_audiences`, `document_acknowledgements`.
Lifecycle: `checklist_templates`, `checklist_template_tasks`, `checklist_instances`, `checklist_tasks`.
Cross-cutting: `audit_log` (append-only, hash-chained per org), `notifications`, `notification_preferences`, `webhooks`, `webhook_deliveries`, `jobs` (pg-boss schema), `settings` (org-level JSONB with Zod-validated schema).

Key constraints:

- No overlapping active `employments` per employee (exclusion constraint with `daterange`).
- No overlapping approved `leave_requests` of the same employee for the same day (exclusion on `leave_request_days` unique key).
- `time_events` and `audit_log` are append-only: `REVOKE UPDATE, DELETE` from the app role plus a trigger raising on update/delete.
- Hash chain: `hash = sha256(prev_hash || canonical_json(event))`; verified by `audit.verify-chain` job and on export.

Encryption: sensitive columns (national id, IBAN, salary) use application-level envelope encryption (AES-256-GCM, per-org data key wrapped by an instance key from env/KMS). Key rotation supported via key id column.

## 7. Key flows

### 7.1 Leave request

1. Web posts `POST /v1/leave/requests` with dates + half-day flags.
2. API authorizes (`leave.request.create`, scope self), loads employee, policy, calendar, existing requests.
3. `core.leave.validateRequest` returns computed days, balance impact, conflicts, coverage warnings (pure).
4. API stores request `pending` + per-day rows, enqueues notifications.
5. Approver acts (`leave.request.approve`, scope reports/department). On approval the service writes ledger `usage` entries in the same transaction as the status change.
6. Cancellation writes compensating ledger entries; nothing is deleted.

### 7.2 Time tracking

Clock actions append `time_events` with server time. A session is derived by folding events (`core.time.foldSessions`). Missing clock-out detection runs daily and prompts a correction. Timesheets are computed on read and cached per closed period.

### 7.3 Offline clock events (PWA)

Client queues events with a client UUID and local timestamp; on reconnect, sends them with `clientEventId` (idempotency). The server records `recorded_at` (server) and keeps `claimed_occurred_at`; if skew exceeds a threshold, the event is flagged for review. Offline queue never fabricates server time.

### 7.4 Exports

`POST /v1/time/exports` enqueues a job; the worker renders CSV/PDF from events, stores the file with a content hash, writes an audit entry, and notifies the requester. Download links are short-lived and permission-checked.

## 8. API conventions

- REST + JSON, versioned path `/v1`. Resource-oriented; verbs only for state transitions (`POST /leave/requests/{id}/approve`).
- Errors: RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail`, `code`, `traceId`, and field `errors[]` for validation.
- Pagination: cursor-based (`limit`, `cursor`), stable sort; total counts optional and cached.
- Idempotency: `Idempotency-Key` header on unsafe POSTs that create records.
- Filtering/sorting via explicit allow-listed query params; no arbitrary SQL-ish filters.
- Dates: `YYYY-MM-DD` for calendar dates, RFC 3339 UTC for instants. Money not used in v1.0.
- Webhooks: signed (HMAC-SHA256), retried with backoff, deliveries visible to admins.

## 9. Frontend structure (apps/web)

```
src/app/[locale]/(auth)/...        sign-in, accept-invite, reset
src/app/[locale]/(app)/...         authenticated shell
  home/ people/ time-off/ time/ documents/ onboarding/ reports/ settings/
src/features/<module>/             feature components, hooks, server actions wrappers
src/lib/                           api client, auth helpers, formatters
```

Feature code imports from `packages/ui`, `packages/contracts`, `packages/i18n`. Cross-feature imports go through public `index.ts`.

## 10. Observability

- Logging: pino JSON, request id, org id, user id (opaque), no PII; log level via env.
- Tracing/metrics: OpenTelemetry SDK optional; `/metrics` (Prometheus) behind a token; `/healthz` (liveness), `/readyz` (db + migrations + queue).
- Error reporting: pluggable interface; default is logs only. No third-party reporting without explicit config.

## 11. Deployment

- `infra/compose/docker-compose.yml`: `web`, `api`, `worker`, `postgres`, `mailpit` (dev), `minio` (optional), `caddy` (TLS reverse proxy sample).
- Single image build with multiple entrypoints or one image per app; non-root, read-only FS, healthchecks.
- Config via env validated at boot (Zod); secrets also accepted as `*_FILE`.
- Backups: `pg_dump`/WAL guidance + object storage sync; restore tested in CI nightly with a sample dataset.
- Upgrades: migrations run automatically on api start (opt-out) with advisory lock; release notes list required actions.
- Scale path: stateless web/api scale horizontally; worker concurrency by queue; Postgres vertical first, then read replicas for reports.

## 12. Security architecture (summary)

Defense in depth: validation at edges, RLS in DB, least-privilege DB roles, encrypted sensitive columns, signed/hashed audit and time records, strict CSP, dependency scanning (OSV/`pnpm audit`, Renovate), secret scanning, SAST (CodeQL), container scanning, SBOM (CycloneDX), reproducible builds, security.txt, coordinated disclosure policy.

## 13. Testing strategy

- Unit (Vitest): `core`, policies, formatters. Property-based (fast-check) for ledger/time invariants.
- Integration: API + real Postgres via Testcontainers; each test runs inside a tenant context; RLS isolation tests auto-generated per table.
- E2E: Playwright against composed stack with seeded data; accessibility via axe; mobile viewport project.
- Contract: OpenAPI diff check in CI to catch breaking changes.
- Performance: k6 smoke on list endpoints and clock-in; budget checks on web bundles.
- Migrations: CI applies from scratch and from the previous release snapshot.

## 14. Extensibility

Module boundaries (`leave`, `time`, `documents`...) are folders with explicit public exports. Future modules (expenses, recruiting, shifts) follow `/new-module`. Integrations use ports/adapters (`StoragePort`, `MailPort`, `AuthPort`, `ClockPort`).
