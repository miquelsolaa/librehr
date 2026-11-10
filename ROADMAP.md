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

## [x] v1.1 - Advanced Enterprise, Compliance & Platform Extensions (Completed)

- **Interactive Org Chart (`ORG-004`):** Real-time organizational hierarchy tree visualization (`/org-chart`) with department filtering and direct report counts.
- **Custom Profile Fields (`ORG-005`):** Configurable dynamic employee attributes (`/settings/custom-fields`) with text, number, date, and select types.
- **Emergency Contacts (`EMP-002`):** Primary and secondary emergency contact details on employee profiles.
- **Employee Self-Service Profile Editing (`EMP-005`):** Restricted employee self-update portal for address, phone, and emergency contacts.
- **In-App Notification Center (`NOT-002`):** Interactive notification bell, unread count badge, and sliding drawer.
- **Document Read Receipts (`DOC-006`):** Mandatory document acknowledgement tracking with compliance timestamps.
- **Tablet Kiosk Mode (`TIM-010`):** Shared tablet clock-in/out station (`/kiosk`) with PIN authentication.
- **Statutory Labour Inspector Role (`TIM-008`):** Restricted read-only inspectorate audit view (`/time/inspector`).
- **Working Time Bank (`TIM-012`):** Overtime and flex-hour balance tracking ledger (`/time/time-bank`).
- **Team Absence Coverage Rules & Blackouts (`LEA-007`):** Minimum team staffing constraints and blackout period rules (`/time-off/rules`).
- **Manager Absence Approval Delegations (`LEA-008`):** Automatic delegation of approval duties during manager absences (`/time-off/delegations`).
- **Enterprise TOTP Two-Factor Authentication (`AUTH-003`):** RFC 6238 TOTP 2FA with recovery codes and organization-wide enforcement (`/settings/security`).
- **Enterprise Single Sign-On (`AUTH-004`, Business edition from v1.3):** OIDC SSO configuration for Google, Microsoft, and generic identity providers with domain restrictions (`/settings/sso`). The sign-in callback is still to be built, in `ee/`.
- **Document Merge Templates (`DOC-007`):** Dynamic template engine with Mustache placeholder substitution (`/documents/templates`).
- **Outbound Webhooks Engine (`ADM-006`):** Event subscription engine with HMAC-SHA256 signature verification, event filtering, and test ping dispatch (`/settings/webhooks`).
- **Statutory Leave Catalogue (`LEA-001`):** Complete statutory absence types under Spanish & European labor law (ET art. 37 & RDL 5/2023) covering marriage, family hospitalization, bereavement, moving, civic duty, prenatal care, family force majeure, unpaid parental leave, maternity/paternity, and exams with legal references and attachment rules.
- **Location-Specific Holiday Calendars & Municipal Holidays (`LEA-003`):** 3-tier statutory holiday inheritance (National, Autonomous Community Regional, and Municipal local holidays) with location calendar management, custom holiday creation, automatic statutory holiday population, and per-work-center absence day deduction.
- **Shift Rosters & Continuous Rotational Systems (`TIM-004`, `TIM-005`):** Complete 24/7 continuous cycle shift engine (e.g. 6x2 continuous rotations: 2 morning, 2 afternoon, 2 night, 2 rest), statutory night hours computation (22:00–06:00, ET art. 36), mandatory 12-hour rest validation (ET art. 34.3), interactive monthly shift roster matrix grid (`/time/shifts`), and colleague shift swap request & manager approval workflow.

## [ ] v1.3 - Open Core & LibreHR Business (In progress)

Business model decided in `docs/adr/0004-open-core-licensing.md`; editions in `docs/editions.md`.

- [x] Governance: CLA (`CLA.md`), LibreHR Enterprise License (`ee/LICENSE`), trademark policy (`TRADEMARKS.md`), editions page.
- [x] **`LIC-001`/`LIC-002`:** `ee/` workspace package, API extension point, offline Ed25519 licence keys, `GET /v1/edition`.
- [x] **`LIC-003` + `AUTH-004`:** move OIDC SSO into `ee/`, `LICENSE_REQUIRED` gating and UI notice.
- [x] CLA, Enterprise License and trademark policy adopted as v1.0.
- [ ] Trademark registration (OEPM/EUIPO).
- [ ] Production licence signing keypair generated offline; public key replaces the placeholder.
- [ ] **LibreHR Cloud:** EU-hosted managed offering (provisioning, billing, backups, status page).
- [ ] **Partner programme** for gestorías, integrators and hosting providers.

## Pending Backlog (What is Left to Build)

The following items represent secondary or post-v1.1 extensions scheduled for subsequent iterations:

1. **`AUTH-006`: WebAuthn / Passkeys Authentication (P2):** Hardware security keys (FIDO2/YubiKey, Apple Touch ID/Face ID, Windows Hello) as passwordless primary or secondary authentication factor.
2. **`ONB-003`: Candidate Pre-boarding Intake Form (P2):** Public or token-authenticated pre-boarding web form allowing newly hired employees to fill in their own personal information, DNI/NIE, and bank details prior to day one.
3. **`NOT-003`: Web Push Notifications (P2):** Web Push API integration for mobile and desktop browser push notifications (service worker, VAPID key exchange).
4. **`RPT-003`: Scheduled Email Digest Reports (P2):** Cron-triggered pg-boss background worker delivering weekly or monthly workforce and absence digests to managers and HR admins.
5. **Direct Payroll Provider Connectors (Business edition):** API connectors for Spanish payroll platforms (A3, Sage, Wolters Kluwer).
6. **Whistleblowing Channel (Ley 2/2023, Community edition: legal compliance stays free):** Statutory anonymous whistleblower submission and communication portal.

## Principles for prioritization

Compliance and data safety first, then employee daily tasks (clock, time off), then admin efficiency, then nice-to-haves.
