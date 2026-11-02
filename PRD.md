# PRD - LibreHR (formerly OpenHR)

Status: Draft v0.1 · Owner: Maintainers · Last updated: 2026-11-01
Related: `PERSONA.md`, `ARCHITECTURE.md`, `COMPLIANCE.md`, `DESIGN.md`, `ROADMAP.md`

## 1. Summary

LibreHR is an open-source (AGPL-3.0), self-hostable HRIS for small and medium businesses in Europe, starting with Spain, Catalonia first.
It replaces spreadsheets, shared calendars, paper forms and ad-hoc email threads with one place for people data, time off, working-time records and documents.
It must be easy to self-host (one `docker compose up`), pleasant for non-technical users, and compliant by default with Spanish and EU rules.

## 2. Problem

- Small companies manage employees, vacations and clock-ins in Excel, WhatsApp and email. This is error-prone and a compliance risk (working-time records are legally required in Spain).
- Commercial SaaS HRIS products solve this but are closed, per-seat priced, and hold sensitive data in third-party clouds. Some companies, public bodies and gestorias want control, self-hosting, or a transparent codebase.
- Existing open-source HR tools are either ERP-heavy, hard to deploy, poorly localized for Spain/Catalonia, or have dated UX.

## 3. Goals and non-goals

### Goals (v1.0)

- G1. A company can go from zero to a working instance with its employees, org chart, holiday calendar and policies in under 60 minutes.
- G2. Employees can request time off and clock in/out from a phone in under 3 taps/clicks for the common case.
- G3. Time-tracking records are tamper-evident, exportable, and ready for the pending Spanish digital working-time regulation.
- G4. Fully localized in Catalan, Spanish and English; accessible (WCAG 2.2 AA).
- G5. Safe by default for personal data: tenant isolation, least privilege, audit trail, retention controls, data-subject-request tooling.
- G6. Easy to contribute to: clear architecture, great docs, fast tests.

### Non-goals (v1.0)

- N1. Payroll calculation (gross-to-net, IRPF, Seguridad Social contributions). We export data for gestorias instead.
- N2. Recruiting/ATS, performance reviews, expenses, learning, shifts planning: post-1.0 (see `ROADMAP.md`).
- N3. Legally qualified electronic signatures (eIDAS QES). Simple "acknowledge/read receipt" only in v1.0.
- N4. Native mobile apps. We ship a responsive PWA.
- N5. Being a drop-in replica of any commercial product or importing from their private APIs.

## 4. Users

See `PERSONA.md`. Primary: People/HR manager (Marta), founder-who-does-HR (Jordi), employee (Laia), team manager (Pere), external gestor (Nuria), self-hoster/IT (Sam).

## 5. Product principles

1. **Compliance by default, configurable by policy.** Sensible Spanish defaults; every number is configuration, not code.
2. **Boring and trustworthy.** Clear states, no surprises, everything auditable.
3. **Employee-first mobile flows; admin-first desktop flows.**
4. **Own your data.** Full export, self-hostable, no phone-home.
5. **Privacy-minimal.** Collect the least data necessary; geolocation and similar are opt-in and justified.
6. **Small surface, deep correctness.** Fewer features, done right (dates, balances, time).

## 6. Release scope

| Release | Theme                 | Modules                                                        |
| ------- | --------------------- | -------------------------------------------------------------- |
| M0      | Foundations           | Repo, CI, auth skeleton, DB + RLS, design system, i18n, Docker |
| M1      | People                | AUTH, ORG, EMP, ADM                                            |
| M2      | Time off              | LEA, calendars, notifications                                  |
| M3      | Time tracking         | TIM, exports, corrections                                      |
| M4      | Documents & lifecycle | DOC, ONB                                                       |
| M5      | Insights & polish     | RPT, import/export, PWA, hardening -> v1.0                     |

## 7. Functional requirements

Priority: **P0** must for the release, **P1** should, **P2** nice. Each requirement has a `Source:` basis (law / domain convention / user research). IDs are stable; reference them in commits and PRs.

### 7.1 AUTH - Authentication and accounts

- **AUTH-001 (P0)** Email + password sign-in with strong hashing, email verification, password reset. _Accept:_ reset links expire in 1 h and are single use; rate limiting on all auth endpoints.
- **AUTH-002 (P0)** Session management: list active sessions, revoke, "sign out everywhere".
- **AUTH-003 (P1)** TOTP two-factor authentication, recovery codes; organization-level "require 2FA".
- **AUTH-004 (P1)** OIDC SSO (Google, Microsoft, generic OIDC) configurable per organization.
- **AUTH-005 (P0)** Invitations: admins invite employees by email; invite creates/links an employee record. _Accept:_ invite tokens expire in 7 days; re-sendable.
- **AUTH-006 (P2)** Passkeys (WebAuthn).
- Source: security best practice (OWASP ASVS L2).

### 7.2 ORG - Organization and structure

- **ORG-001 (P0)** First-run setup wizard creates organization, first admin, default locale, time zone, legal entity name/tax id, working-week template.
- **ORG-002 (P0)** Multiple legal entities and work locations (centros de trabajo) per organization; each location has a country/region/city used to select holiday calendars.
- **ORG-003 (P0)** Departments and teams (tree), with team leads and reporting lines (manager of employee).
- **ORG-004 (P1)** Organization chart view (searchable, collapsible).
- **ORG-005 (P1)** Custom fields on employee profiles (text, number, date, select), with visibility rules.
- **ORG-006 (P0)** Multi-tenant: multiple organizations per instance fully isolated (RLS); instance super-admin can only manage organizations, never read tenant data.

### 7.3 EMP - Employees

- **EMP-001 (P0)** Employee directory with search, filters (department, location, status), sort, server-side pagination, CSV export (permissioned).
- **EMP-002 (P0)** Employee profile: personal data (name, preferred name, birth date, contact, address, emergency contact), job data (job title, department, manager, location, start date, employment type), and status (active, on leave, terminated).
- **EMP-003 (P0)** Employment history: contracts/positions over time with effective dates (never overwrite; append a new period).
- **EMP-004 (P0)** Field-level visibility by role and relationship (self, manager, HR, admin). Sensitive fields (national id, IBAN, salary) restricted to HR/admin and encrypted at rest.
- **EMP-005 (P1)** Employee self-service: edit own contact data and emergency contacts; changes requiring approval go to HR.
- **EMP-006 (P1)** Bulk import from CSV with validation report and dry-run. _Accept:_ never partially applies; row-level errors listed.
- **EMP-007 (P0)** Offboarding: set termination date and reason (coarse categories), revoke access at termination, preserve records per retention policy.
- Source: domain convention; RGPD data minimisation (art. 5.1.c).

### 7.4 LEA - Time off

- **LEA-001 (P0)** Configurable leave types (vacation, personal days, sick, maternity/paternity, unpaid, custom) with flags: paid, requires approval, requires attachment, half-days allowed, counts working or calendar days, visible-to-team detail level.
- **LEA-002 (P0)** Leave policies assigned per employee/group: annual entitlement, accrual method (upfront / monthly / daily), carry-over rules and expiry, prorating for mid-year start/end, part-time contracts.
- **LEA-003 (P0)** Holiday calendars per location (national, regional, local), editable by admins; organization can add company holidays. Seeded with Spain national + autonomous community data, maintainable by community PRs.
- **LEA-004 (P0)** Request flow: employee selects dates (incl. half-days), sees computed working days and remaining balance, adds a note/attachment, submits. Manager (or delegate) approves/rejects with comment; employee notified. _Accept:_ overlapping or insufficient-balance requests are blocked or flagged per policy; cancelling an approved request restores balance via a compensating ledger entry.
- **LEA-005 (P0)** Balances derived from an append-only ledger (accrual, usage, adjustment, carry-over, expiry) with a full explanation view ("why is my balance 12.5?").
- **LEA-006 (P0)** Team and company calendar showing who is away, respecting visibility rules (e.g. show "Away" without leave type for non-HR).
- **LEA-007 (P1)** Coverage rules: warn/block when more than N people of a team are away the same day.
- **LEA-008 (P1)** Delegate approver when a manager is away.
- **LEA-009 (P1)** iCalendar (ICS) feed per user/team (tokenized URL).
- **LEA-010 (P1)** HR can create/adjust leave on behalf of employees with mandatory reason (audited).
- Source: Estatuto de los Trabajadores art. 38 (minimum 30 calendar days annual vacation, agreement-dependent specifics), collective agreements (configurable), domain convention.

### 7.5 TIM - Time tracking (registro de jornada)

- **TIM-001 (P0)** Clock in / clock out / start break / end break from web and phone (PWA), one-tap widget on the home screen.
- **TIM-002 (P0)** Records are **append-only events**. Each event stores actor, timestamp (server time, UTC), source (web/mobile/manual/import), optional note, and a hash linking to the previous event of the employee (tamper evidence).
- **TIM-003 (P0)** Corrections/forgotten clock-outs: employee proposes a correction with reason; manager/HR approves; original events remain visible; a correction event references the original.
- **TIM-004 (P0)** Daily/weekly/monthly timesheet view per employee with worked, break, and overtime totals computed against the employee's working-time schedule.
- **TIM-005 (P0)** Working-time schedules: fixed, flexible, split shifts, part-time; maximum daily/weekly hours and minimum rest (12 h between workdays, configurable) produce warnings.
- **TIM-006 (P0)** Exports: CSV and PDF per employee/period/organization for the Labour Inspectorate, signed with a content hash and generation metadata.
- **TIM-007 (P0)** Retention: records kept at least **4 years**, available to employees, their representatives, and inspectors; deletion blocked before the retention period ends.
- **TIM-008 (P1)** Read-only **inspector/auditor role** with time-boxed access and full access logging (anticipating the pending digital-registry regulation requiring remote access).
- **TIM-009 (P1)** Employee notification when records are corrected; monthly summary available to the employee.
- **TIM-010 (P1)** Optional kiosk mode (shared device with PIN/QR) for sites without personal devices.
- **TIM-011 (P2)** Optional geolocation at clock time: off by default, per-location opt-in, purpose stated, employee notice displayed (LOPDGDD art. 90). Never continuous tracking.
- **TIM-012 (P1)** Time bank / compensatory rest for overtime, configurable.
- Source: ET art. 34.9 (RDL 8/2019); pending digital-registry Real Decreto (verify status before each release, see `COMPLIANCE.md`); LOPDGDD arts. 87-91.

### 7.6 DOC - Documents

- **DOC-001 (P0)** Per-employee document folders (contracts, payslips, certificates, other) with upload, download, replace (versioned), delete (soft, retained per policy).
- **DOC-002 (P0)** Company-wide documents (policies, handbook) with audience targeting (all, location, department).
- **DOC-003 (P0)** Permissions: employee sees own documents; HR sees all in scope; payslip-type documents visible to employee and payroll role only.
- **DOC-004 (P0)** Storage on local disk or S3-compatible object storage; files encrypted at rest (envelope encryption); malware scan hook; size and MIME allow-lists.
- **DOC-005 (P1)** Bulk upload of payslips (PDF per employee, matched by filename convention or CSV index) with dry-run report; employees notified.
- **DOC-006 (P1)** "Acknowledged" read receipt for policy documents with timestamp.
- **DOC-007 (P2)** Document templates with merge fields (contract letters, certificates).
- Source: domain convention; RGPD art. 32 (security).

### 7.7 ONB - Onboarding and offboarding

- **ONB-001 (P0)** Checklist templates (tasks with owner role, due offset relative to start/end date, description, attachment).
- **ONB-002 (P0)** Instantiate a checklist for a new hire or leaver; track progress; notify owners; overdue highlighting.
- **ONB-003 (P1)** New-hire self-service form to complete personal data and upload required documents before day 1.
- **ONB-004 (P1)** Offboarding checklist triggers access revocation reminders and final document generation.

### 7.8 ADM - Administration, roles, audit

- **ADM-001 (P0)** Roles: Owner, HR Admin, Payroll, Manager, Employee, Auditor (read-only), plus custom roles built from permissions. Permission scopes: self, reports, department, location, organization.
- **ADM-002 (P0)** Audit log of security- and privacy-relevant actions (login, permission changes, sensitive field views/changes, exports, time corrections, document access). Immutable, filterable, exportable.
- **ADM-003 (P0)** Organization settings: locale, time zone, working week, holiday calendars, leave and time policies, branding (logo/name), notification defaults.
- **ADM-004 (P1)** Data-subject request tooling: export all data of one employee (machine-readable JSON + human-readable PDF), anonymize after retention.
- **ADM-005 (P1)** Retention policies by data category with scheduled enforcement and a dry-run report.
- **ADM-006 (P1)** Webhooks and a documented public REST API with personal access tokens (scoped, revocable).

### 7.9 NOT - Notifications

- **NOT-001 (P0)** Email notifications (leave requested/approved/rejected, correction requests, onboarding tasks, document uploaded) with per-user preferences; templates in ca/es/en.
- **NOT-002 (P0)** In-app notification center with unread counts.
- **NOT-003 (P1)** Web push for PWA; daily digest option.
- **NOT-004 (P0)** All outbound mail via configurable SMTP; no third-party tracking pixels.

### 7.10 RPT - Reports and exports

- **RPT-001 (P1)** Headcount, joiners/leavers, absence rate, leave balances, overtime summaries with date filters and CSV export.
- **RPT-002 (P1)** Gestoria export: monthly CSV/XLSX with worked days, absences by type, overtime, and employee identifiers, with configurable column mapping.
- **RPT-003 (P2)** Scheduled reports by email.

### 7.11 I18N / A11Y

- **I18N-001 (P0)** UI and emails in `ca`, `es`, `en`; per-user locale; dates, numbers, and first day of week follow locale; no hard-coded strings.
- **A11Y-001 (P0)** WCAG 2.2 AA: keyboard operable, visible focus, screen-reader labels, sufficient contrast, reduced motion respected.

## 8. Non-functional requirements

- **Performance:** p95 API latency < 300 ms for common reads at 500 employees; directory renders < 1 s on mid-range phones over 4G; supports 5,000 employees per organization with pagination.
- **Availability and ops:** single-node Docker deployment supported; documented backup/restore (Postgres + object storage); zero-downtime migrations as a goal for v1.0.
- **Security:** OWASP ASVS L2 target; RLS tenant isolation verified by tests; secrets via env/secret files; CSP, HSTS, secure cookies; dependency scanning; reproducible builds; SBOM per release.
- **Privacy:** no telemetry by default; no third-party runtime assets; PII-free logs; data export and deletion per RGPD.
- **Observability:** structured logs, health/readiness endpoints, optional OpenTelemetry export, Prometheus metrics endpoint.
- **Compatibility:** latest two versions of evergreen browsers; iOS Safari 16+; Android Chrome latest.
- **Licensing:** AGPL-3.0-or-later; all dependencies compatible; `NOTICE` and SBOM maintained.
- **Docs:** user guide (ca/es/en), admin/self-hosting guide, API reference (OpenAPI), contributor guide.

## 9. Data model (overview)

See `ARCHITECTURE.md` section 6. Key aggregates: Organization, LegalEntity, Location, User, Employee, Employment, Department, Team, LeaveType, LeavePolicy, LeaveLedgerEntry, LeaveRequest, HolidayCalendar, Schedule, TimeEvent, TimeCorrection, Document, ChecklistTemplate, ChecklistInstance, AuditLog, Notification.

## 10. Integrations (roadmap)

- v1.0: SMTP, S3-compatible storage, OIDC, ICS feeds, webhooks, CSV/XLSX import/export.
- Later: gestoria-specific export formats, SEPA, Slack/Teams notifications, SCIM provisioning, accounting exports.

## 11. Success metrics

- Time to first working instance (target < 60 min, measured via setup telemetry-free survey).
- Leave request to decision median time.
- % of employees clocking via the app on workdays (for adopters).
- Zero cross-tenant data leaks in security tests; 100% of requirements traceable to tests.
- Community: contributors per quarter, issues resolved, translation coverage (ca/es/en 100%).

## 12. Risks and mitigations

| Risk                                                     | Impact          | Mitigation                                                                                                |
| -------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| Spanish digital registry regulation changes requirements | Rework in TIM   | Event-sourced time log, configurable exports, track the regulation in `COMPLIANCE.md` before each release |
| Date/leave logic bugs                                    | Loss of trust   | Pure `core` package, property-based tests, DST/leap-year fixtures                                         |
| Data leak across tenants                                 | Severe          | RLS + tests + code review checklist + pentest before v1.0                                                 |
| Accidental copying of third-party material               | Legal           | `CLEANROOM.md`, PR attestation, review                                                                    |
| Scope creep into payroll                                 | Delay           | Non-goal N1; export only                                                                                  |
| Maintainer burnout                                       | Project failure | Small scope, good docs, CI, clear contribution paths                                                      |

## 13. Open questions

1. Final project name and domain (trademark and domain check).
2. Hosted offering later? (affects AGPL positioning and CLA vs DCO; current decision: DCO).
3. Which autonomous communities' holiday data to seed first? (Proposed: Catalunya, Madrid, Valencia, Andalucia, Pais Vasco.)
4. Do we support multiple employments per person (pluriempleo) in v1.0 or later? (Proposed: later; data model allows it.)
5. Minimum browser/device support for kiosk mode.
