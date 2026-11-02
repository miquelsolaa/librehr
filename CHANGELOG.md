# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
