# ROADMAP.md

Time-boxed estimates assume 1-3 core contributors plus AI assistance. Adjust after M0. Requirement IDs refer to `PRD.md`.

## M0 - Foundations (2-3 weeks)

Monorepo, CI, Docker dev stack, DB + RLS harness and cross-tenant test generator, auth skeleton, design tokens + base components, i18n pipeline, seed data, docs site skeleton, issue/PR templates, security policy.
**Exit:** `pnpm dev` works; empty app shell with sign-in, locale switch, dark mode; `pnpm verify` green in CI.

## M1 - People (3-4 weeks)

AUTH-001/002/005, ORG-001/002/003/006, EMP-001/002/003/004/007, ADM-001/002/003, NOT-004.
**Exit:** setup wizard, invite employees, directory and profiles, roles, audit log.

## M2 - Time off (4-5 weeks)

LEA-001..006, LEA-010, NOT-001/002, holiday calendars (ES national + 5 regions).
**Exit:** request/approve/cancel with ledger-based balances and calendar; property tests green.

## M3 - Time tracking (4-5 weeks)

TIM-001..007, TIM-009, schedules, exports, daily missing-clock-out job, PWA offline queue.
**Exit:** compliant-by-design time records with exports and corrections.

## M4 - Documents and lifecycle (3-4 weeks)

DOC-001..005, ONB-001..002, EMP-006, ADM-004/005.
**Exit:** employee documents, payslip bulk upload, onboarding checklists, DSR tooling.

## M5 - Insights, hardening, v1.0 (4-6 weeks)

RPT-001/002, AUTH-003/004, LEA-007..009, TIM-008/010/012, ADM-006, performance and a11y audits, pentest, docs ca/es/en, compliance review.
**Exit:** v1.0 release candidate, SBOM, signed images, upgrade guide.

## After 1.0 (candidates)

Expenses · Recruiting/ATS · Performance and goals · Shift planning · Payroll-provider and gestoria connectors · SCIM · Slack/Teams · Native/Capacitor apps · e-signature · Whistleblowing channel · Multi-language holiday data community hub.

## Principles for prioritization

Compliance and data safety first, then employee daily tasks (clock, time off), then admin efficiency, then nice-to-haves.
