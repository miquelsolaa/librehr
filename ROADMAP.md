# ROADMAP.md

Time-boxed estimates assume 1-3 core contributors plus AI assistance. Adjust after M0. Requirement IDs refer to `PRD.md`.

## [x] M0 - Foundations (Completed)

Monorepo, CI, Docker dev stack, DB + RLS harness and cross-tenant test generator, auth skeleton, design tokens + base components, i18n pipeline, seed data, docs site skeleton, issue/PR templates, security policy.

- **Exit Status:** Completed. `pnpm dev` works; app shell with sign-in, locale switch, dark mode; `pnpm verify` green in CI.

## [x] M1 - People (Completed)

AUTH-001/002/005, ORG-001/002/003/006, EMP-001/002/003/004/007, ADM-001/002/003, NOT-004.

- **Exit Status:** Completed. First-run setup wizard (`/setup`), employee directory & profile views (`/people`, `/people/:id`), invitation tokens (`/invite/:token`), departments/work centers settings, RBAC (admin/hr/manager/employee), and immutable audit logging.

## [x] M2 - Time off (Completed)

LEA-001..006, LEA-010, NOT-001/002, holiday calendars (ES national + 5 autonomous communities).

- **Exit Status:** Completed. Request, approve, and cancel workflows with append-only ledger balances, interactive team calendar (`/time-off/calendar`), half-day support, non-deductible statutory leaves, and property-based tests green.

## [x] M3 - Time tracking (Completed)

TIM-001..007, TIM-009, schedules, exports, daily missing-clock-out job, PWA offline queue.

- **Exit Status:** Completed. Compliant-by-design working time records (Real Decreto-ley 8/2019), immutable entry/break/exit events, SHA-256 tamper-evident hash chaining, timesheet correction requests and manager approvals (`/time/corrections`), labour inspection exports (`/time/export`), and scheduled midnight auto-close jobs.

## [x] M4 - Documents and lifecycle (Completed)

DOC-001..005, ONB-001..002, EMP-006, ADM-004/005.

- **Exit Status:** Completed. Secure document repository (`/documents`) with AES-256-GCM metadata and S3 storage, bulk PDF payslip upload and employee NIF/NIE auto-matching, onboarding/offboarding lifecycle checklists (`/onboarding`), atomic bulk employee CSV import, and GDPR Article 15 DSR export tool (`GET /v1/people/:id/dsr-export`).

## [x] M5 - Insights, hardening, v1.0 RC (Completed)

RPT-001/002, AUTH-003/004, LEA-007..009, TIM-002, ADM-006, performance audits, docs ca/es/en, compliance review.

- **Exit Status:** Completed. Workforce analytics dashboard (`/reports`) with headcount, turnover, and absence rates; Spanish Gestoría payroll RFC 4180 CSV export; Personal Access Tokens (PATs) with SHA-256 hashing and API authentication (`/settings/tokens`); iCalendar `.ics` feed subscription (`/v1/calendar/feed.ics`); background tamper-evident audit hash verification job (`TIM-002`); v1.0 release candidate verified.

## After 1.0 (candidates)

Expenses · Recruiting/ATS · Performance and goals · Shift planning · Payroll-provider and gestoria direct API connectors · SCIM · Slack/Teams · Native/Capacitor apps · e-signature · Whistleblowing channel · Multi-language holiday data community hub.

## Principles for prioritization

Compliance and data safety first, then employee daily tasks (clock, time off), then admin efficiency, then nice-to-haves.
