# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [Unreleased]

### Security

- **Webhook delivery pinned to the validated IP (#35, `ADM-006`):** the SSRF guard resolved the webhook host and checked its addresses, then the HTTP client resolved it again on connect, leaving a DNS-rebinding window. Deliveries now resolve once, validate every address and connect only to those addresses, keeping the hostname for the `Host` header, TLS SNI and certificate verification (always on, even with `NODE_TLS_REJECT_UNAUTHORIZED=0`). Redirects are never followed. Webhook delivery does not use `HTTP_PROXY`/`HTTPS_PROXY`; see `docs/guides/self-hosting.md`. IPv4-translated `::ffff:0:0/96` and the `3fff::/20` documentation range are now also rejected.
- **Shared rate limits and lockouts (#35):** the request rate limits (sign-in, two-factor, setup wizard, kiosk, time exports) and the failure lockouts (two-factor codes, kiosk PINs) move from per-process memory to Postgres (`rate_limit_buckets`, migration 0038), so several API replicas share one budget per client. The numeric limits, windows and lockout durations are unchanged; what a client is changes for IPv6 (below). Bucket keys are HMAC-SHA256 digests under a key derived from `SESSION_SECRET`; no IP, email or identifier is stored. Replicas must share the same `SESSION_SECRET`. Windows use the database clock. Two-factor codes and kiosk PINs reserve each attempt atomically before it is checked, so at most the configured number of guesses is ever verified, even when they arrive concurrently at several replicas. Per-IP limits now count IPv6 clients per /64 network (IPv4, and IPv6 addresses embedding IPv4, per address), so a whole /64 shares one per-IP budget. The API refuses to start in production without `SESSION_SECRET`.

### Fixed

- **Document files are stored on the storage volume (#32, `DOC-001`):** the API ignored `STORAGE_LOCAL_DIR` and wrote uploaded files to `./data/storage` under its working directory, outside the `librehr_storage` volume, where container recreation loses them. The API now reads `STORAGE_LOCAL_DIR` (default `./data/storage`) and refuses a `STORAGE_DRIVER` other than `local`; the API image creates `/data/storage` owned by its non-root user. The API exits at start when it cannot write to that directory. Existing installs: see `docs/guides/upgrading.md`.
- **Storage keys cannot leave the storage directory (#32, `DOC-005`):** the bulk payslip upload put the client-supplied filename into the storage key unsanitized, so a name containing `../` could write outside the storage directory. Bulk payslip filenames are now sanitized like single uploads, and the local storage adapter refuses absolute keys and keys that resolve outside `STORAGE_LOCAL_DIR`.

### Leave balances per leave type

- **Per-type balances (`LEA-005`, #117):** `leave_ledger` records the leave type of every entry (migration 0033, with a backfill of usage, reversal and accrual entries). `GET /v1/leave/balance` returns `byType`, and the time-off and home pages show one balance per leave type. Untyped legacy entries form an "Unassigned" balance. Only leave types with a policy limit requests.
- **Part-time accrual, opt-in (`LEA-002`, #118):** a leave policy can set the full-time week of its collective agreement (`full_time_hours_per_week`, at most 40 h per ET art. 34.1, migration 0034); accrual is then prorated by contract hours (capped at 1). Unset, the default, keeps FTE 1.0, as statutory vacation requires (ET art. 12.4.d). New `GET/POST /v1/leave/policies`, `PATCH /v1/leave/policies/{id}` and Settings > Leave policies (ca/es/en).
- **Year-end carry-over, forfeit and expiry (`LEA-002`, #116):** the January run of `leave.accrue` settles the previous year (final true-up) and closes it per employee and leave type. By default the whole remaining balance is carried over and nothing is lost. A policy can opt in to `carryoverEnforced` (migration 0036, Settings > Leave policies, audited): the balance is then carried over up to `carryover_max_days`, the rest is forfeited (new `forfeit` entry type), and carried days left unused after `carryover_expiry_months` expire, on a date fixed at the close. Employees with leave protected by ET art. 38.3 (incapacity, pregnancy, birth, adoption, breastfeeding) in the closed year or the year before keep their whole balance, and their carried days do not expire. Idempotent through `source_ref`. The unassigned bucket is never closed. `GET /v1/leave/balance` adds `totalExpired` (top level and per type).
- **Accrual true-up (`LEA-002`, #116):** when more was accrued than is due, `leave.accrue` writes a negative `accrual` entry instead of only logging a warning.
- **Upfront allowances on 1 January (`LEA-002`, #129):** `upfront` policies are credited by the run that precedes the month they start in, so the allowance is there at the start of the year or of the employment.
- **Breaking API change:** `POST /v1/leave/adjust` requires `leaveTypeId` (or `null` for the unassigned balance). See `docs/guides/upgrading.md`.

### Open core: Community and Business editions

- **Licensing model (ADR 0004):** LibreHR is now open core. Code outside `ee/` stays AGPL-3.0-or-later; the new `ee/` directory is source-available under the LibreHR Enterprise License v1.0. Legal-compliance features remain in Community. See `docs/editions.md`.
- **Contributor License Agreement:** contributions now require agreeing to `CLA.md` (pull request checkbox) in addition to the DCO sign-off.
- **Trademark policy:** `TRADEMARKS.md` describes how the LibreHR name and logo may be used.
- **PRD:** new `LIC-001`..`LIC-003` requirements; `AUTH-004` (SSO) becomes a Business feature.
- **Editions and licence keys (`LIC-001`, `LIC-002`):** new `@librehr/ee` workspace package with offline Ed25519 licence key verification (no phone-home); API extension point (`apps/api/src/extensions/`) that mounts licensed Business routes and answers `403 LICENSE_REQUIRED` otherwise; `GET /v1/edition`; `LIBREHR_LICENSE_KEY` setting (self-hosting guide, compose, env examples). Lint keeps Community code from importing `ee/`. The production public key is a placeholder until generated, so every instance runs as Community for now.
- **SSO moves to Business (`AUTH-004`, `LIC-003`):** the SSO routes and OIDC helpers move from `apps/api` and `packages/core` into `ee/core/src/sso/`. Without a licence granting `sso`, `/v1/sso/*` answers `403 LICENSE_REQUIRED` and `/settings/sso` explains it; the settings card shows a "Business" badge (ca/es/en). The SSO table, repository and contracts stay in Community. Two-factor authentication (`AUTH-003`) stays in Community.

## [1.2.0] - 2026-11-02

### Statutory Leaves, Municipal Calendars & Continuous Shift Systems

- **Spanish Statutory Leave Types (`LEA-001`):** Domain model, database schema, and migration for all 13 canonical statutory absence types under Spanish labour law (Estatuto de los Trabajadores art. 37 and Real Decreto-ley 5/2023):
  - Marriage / Civil Partnership (`ET art. 37.3.a` - 15 calendar days).
  - Family Hospitalization, Surgery & Serious Illness (`ET art. 37.3.b (RDL 5/2023)` - 5 working days).
  - Bereavement / Death of Family Member (`ET art. 37.3.b bis` - 2 to 4 days).
  - Relocation / Moving (`ET art. 37.3.c` - 1 day).
  - Public & Civic Duty (`ET art. 37.3.d` - inexcusable time).
  - Prenatal Examinations & Adoption Preparation (`ET art. 37.3.f` - necessary time).
  - Urgent Family Force Majeure (`ET art. 37.9 (RDL 5/2023)` - up to 4 paid days/year).
  - Unpaid Parental Leave (`ET art. 48 bis (RDL 5/2023)` - up to 8 weeks unpaid).
  - Birth & Childcare (`ET art. 48.4` - 16 weeks).
  - Academic & Professional Examinations (`ET art. 23.1.a` - necessary time).
- **Statutory Leave Request Metadata & UI Preview:**
  - `leave_types` schema augmented with `requires_attachment`, `legal_reference`, and `description`.
  - Dynamic visual preview in `/time-off/request` rendering paid/unpaid badges, statutory legal references (`ET art. 37.x`), and attachment requirement indicators.
- **Location-Specific Municipal Holiday Calendars (`LEA-003` - Phase B):**
  - Pure domain resolution engine (`packages/core/src/calendar/statutory-holidays.ts`) supporting 3-tier statutory holiday inheritance: National (8-9 days), Regional Autonomous Community (4 days: CT, MD, VC, AN, PV), and Municipal Town Hall (2 local days: Barcelona, Madrid, Valencia, Sevilla, Bilbao).
  - API endpoints: `POST /v1/calendar/holidays`, `DELETE /v1/calendar/holidays/:id`, and `POST /v1/calendar/seed-statutory`.
  - Web UI in `/settings/locations`: Interactive holiday calendar per work center with year selection (2025, 2026, 2027), scope badges (`national`, `regional`, `local`, `company`), 1-click statutory holiday generator, and custom municipal holiday management.
- **Shift Rosters & Continuous Rotational Systems (`TIM-004`, `TIM-005` - Phase C):**
  - Rotational continuous cycle engine (`packages/core/src/time/rotational-shifts.ts`) supporting 24/7 continuous operations (e.g., 6x2 continuous cycles: 2 morning, 2 afternoon, 2 night, 2 rest) independent of standard 7-day weekly constraints.
  - Statutory night work computation (22:00–06:00, Estatuto de los Trabajadores art. 36) for night-shift premium payroll reporting.
  - Statutory daily rest period verification (minimum 12 consecutive hours between shifts, ET art. 34.3).
  - Database schema & migration `0013_shift_rotations.sql` creating `shift_templates`, `shift_patterns`, `shift_pattern_steps`, `shift_assignments`, and `shift_swaps` with full RLS tenant isolation.
  - API endpoints for templates, patterns, assignments, roster generation, and peer-to-peer shift swaps.
  - Web UI at `/time/shifts`: Interactive monthly roster matrix (employees × days) with colored shift pills (`M`, `T`, `N`, `OFF`), night hours KPI card, 1-click continuous cycle generator, and colleague shift swap request & manager decision workflow.
  - Trilingual localization (`ca`, `es`, `en`) for all holiday and shift management interfaces.

## [1.1.0] - 2026-11-02

### Advanced Enterprise, Compliance & Platform Extensions

- **Outbound Webhooks Engine (`ADM-006`):** Configurable HTTP webhook endpoints in Settings (`/settings/webhooks`) with HMAC-SHA256 signature verification (`X-LibreHR-Signature-256`, timestamp header), event filtering (`employee.created`, `leave.approved`, etc.), live test ping dispatch with latency measurement, and delivery status tracking.
- **Enterprise Two-Factor Authentication (`AUTH-003`):** Time-based One-Time Password (TOTP) 2FA with RFC 6238 compliance, QR code provisioning, 8 single-use recovery codes, and mandatory organization-wide 2FA policy enforcement in `/settings/security`.
- **Enterprise Single Sign-On (`AUTH-004`):** OpenID Connect (OIDC) SSO integration supporting Google Workspace, Microsoft Entra ID / Office 365, and generic OIDC providers with domain restrictions, automatic account linking, and SSO enforcement toggles in `/settings/sso`.
- **Document Merge Templates (`DOC-007`):** Reusable document templates with Mustache placeholder interpolation (`{{employee.name}}`, `{{company.name}}`, `{{contract.start_date}}`), template preview, category filtering, and one-click employee document generation.
- **Interactive Org Chart & Team Visualization (`ORG-004`):** Visual organizational hierarchy tree at `/org-chart` with department badges, direct reports counters, full-tree zoom/pan navigation, and employee profile navigation.
- **Custom Profile Fields (`ORG-005`):** Dynamic schema configuration for custom employee attributes (text, number, date, select) with admin configuration at `/settings/custom-fields` and live editing on employee profiles.
- **Emergency Contacts (`EMP-002`):** Primary and secondary emergency contact management with relationship types, phone numbers, and priority tagging on employee profiles.
- **Employee Self-Service Profile Editing (`EMP-005`):** Self-service contact updates allowing employees to update their own address, personal phone, and emergency contacts without full employee editing permissions.
- **In-App Notification Bell & Drawer (`NOT-002`):** Real-time notification center in the top navigation bar with unread counters, notification drawer, category badges, and mark-all-as-read actions.
- **Document Read Receipts & Acknowledgement (`DOC-006`):** Mandatory document acknowledgement tracking with compliance audit timestamps and employee sign-off prompts.
- **Shared Tablet Kiosk Mode (`TIM-010`):** High-throughput PIN-based clock-in/out terminal at `/kiosk` for physical workplace tablets with offline protection and employee PIN administration.
- **Statutory Labour Inspector Role (`TIM-008`):** Restricted read-only view (`/time/inspector`) for Spanish labour inspection auditors with date-filtered time records and SHA-256 tamper-evident verification.
- **Working Time Bank & Flex Ledger (`TIM-012`):** Working time bank ledger at `/time/time-bank` tracking accrued overtime hours, flex balances, and time compensations.
- **Team Absence Coverage Rules & Blackout Periods (`LEA-007`):** Minimum staffing constraints and company blackout date ranges (`/time-off/rules`) preventing leave approvals when team coverage falls below thresholds.
- **Manager Absence Approval Delegations (`LEA-008`):** Temporary manager approval delegation (`/time-off/delegations`) automatically routing leave requests to delegates while a manager is out of office.

## [1.0.0-rc.1] - 2026-11-02

### Milestone M5 - Insights, Integrations, Hardening & v1.0 Release Candidate

- **Workforce Analytics (`RPT-001`):** Headcount metrics, joiners/leavers evolution, turnover rate calculations, and absence rate analytics with date filters and dynamic visual KPI cards.
- **Gestoría Payroll Export (`RPT-002`):** Compliant Spanish payroll export generating RFC 4180 CSV with CRLF line endings, standardized column mapping (`NIF_NIE`, `Dias_Trabajados`, `Dias_IT_Enfermedad`, `Dias_Maternidad_Paternidad`, `Dias_Vacaciones`, `Horas_Extra`), and direct web download.
- **Personal Access Tokens (`ADM-006`):** Full PAT management with secure `lhr_<entropy>` prefixes, SHA-256 one-way hashing at rest, granular scope enforcement (`read`, `write`, `admin`), one-time plain token reveal modal, instant revocation, and Bearer PAT authentication in the API middleware.
- **iCalendar Subscriptions (`LEA-009`):** RFC 5545 compliant `.ics` calendar subscription feeds for team absences and public holidays at `/v1/calendar/feed.ics`.
- **Tamper-Evident Chain Audit Job (`TIM-002`):** Scheduled background worker job in `apps/worker` verifying cryptographic hash chain links across historical time tracking events and raising security alerts on sequence gaps.
- **Branding Migration:** Unified repository naming to LibreHR (`@librehr/*` package scope), updated brand assets, and clean-room verification.

## [0.5.0] - 2026-11-02

### Milestone M4 - Documents, Payslips & Lifecycle Management

- **Employee Document Vault (`DOC-001`, `DOC-002`):** Secure metadata and S3-compatible file storage with categorized document classification (contracts, payslips, certificates, policies), company-wide vs individual distribution, and AES-256-GCM metadata protection.
- **Bulk Payslip Upload & Auto-Matching (`DOC-004`):** Multi-file PDF payslip distribution with server-side text extraction matching employees by Spanish NIF/NIE and name.
- **Employee Lifecycle & Checklists (`ONB-001`, `ONB-002`):** Standard onboarding and offboarding task templates, role-based assignments, due-date offsets relative to hire/termination dates, and progress tracking.
- **Atomic Bulk Employee Import (`EMP-006`):** CSV import engine with validation preview and all-or-nothing transactional guarantees.
- **GDPR Article 15 DSR Export Tool (`ADM-004`, `ADM-005`):** Zip archive generator bundling employee profile, contracts, leave ledger events, time records, and uploaded documents.

## [0.4.0] - 2026-11-02

### Milestone M3 - Working Time Tracking (Registro de Jornada)

- **Compliant Daily Time Records (`TIM-001`, `TIM-003`):** Real Decreto-ley 8/2019 compliant daily clock-in, break start/end, and clock-out with immutable event records.
- **SHA-256 Tamper-Evident Hash Chaining (`TIM-002`):** Cryptographic verification chains where each event hashes the prior record, actor, timestamp, and source.
- **Timesheet Corrections Workflow (`TIM-005`):** Non-destructive corrections creating audit trails with mandatory justifications and manager approval.
- **Official Labour Inspectorate Export (`TIM-006`):** Statutory export format with employee summaries, worked hours, and verification hashes.
- **Daily Auto-Close Worker Job (`TIM-009`):** Scheduled worker queue identifying unclosed open shifts and flagging them for review.

## [0.3.0] - 2026-11-01

### Milestone M2 - Time Off & Absence Ledgers

- **Append-Only Leave Ledger (`LEA-001`, `LEA-002`):** Derived leave balances calculated by folding immutable ledger transactions (accruals, deductions, adjustments).
- **Statutory Holiday Calendars (`LEA-003`):** Official Spanish national and regional holiday calendars (Catalonia, Madrid, Andalusia, Valencia, Basque Country, Galicia, Balearic Islands).
- **Leave Request & Approval Workflows (`LEA-004`, `LEA-005`):** Request submission with half-day support, conflict detection, manager approval, and cancellation flows.
- **Non-Deductible Statutory Leaves (`LEA-006`):** Special absence types under Spanish Estatuto de los Trabajadores (bereavement, marriage, moving).

## [0.2.0] - 2026-11-01

### Milestone M1 - People & Organization Structure

- **First-Run Setup Wizard (`ORG-001`):** Guided initialization configuring organization, work center, and initial administrator credentials.
- **Employee Directory & Profiles (`EMP-001`, `EMP-002`):** Searchable people directory, detailed employee profile views, emergency contacts, and statutory contract details.
- **Invitation System (`AUTH-005`):** Secure time-limited invitation tokens with automated email notifications.
- **Role-Based Access Control (`AUTH-002`):** Granular permission checks for admin, HR manager, team manager, and employee roles.
- **Immutable Audit Logging (`ADM-001`):** Complete audit trail tracking administrative actions and permission changes.

## [0.1.0] - 2026-11-01

### Milestone M0 - Foundations

- Initial monorepo scaffolding with Turborepo, pnpm, strict TypeScript, and ESLint flat config.
- Tenant isolation and RLS harness in PostgreSQL with Drizzle ORM.
- Pure core domain logic for calendar calculations, leave ledger folding, and tamper-evident time tracking hash chains.
- REST API powered by Hono with OpenAPI contract generation and Better Auth integration.
- Asynchronous worker queue powered by pg-boss with React Email templates.
- Design system tokens, UI component library, and Next.js web application shell with Catalan, Spanish, and English localization.
- Multi-stage Docker containerization and developer tooling (`doctor`, `stubs:list`).
