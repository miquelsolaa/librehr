# COMPLIANCE.md - Legal and regulatory guide for engineers

> Engineering guidance, **not legal advice**. Verify against current sources (BOE, EUR-Lex, AEPD, Ministerio de Trabajo) and have a labour/data-protection lawyer review before v1.0 and before each release that changes defaults. Last reviewed: 2026-11-01. Update this file whenever regulation changes.

## 1. Roles under GDPR

- **Self-hosted:** the customer company is the **data controller**; the project is software only. Provide docs to help them meet obligations.
- **LibreHR Cloud (planned, `docs/adr/0004-open-core-licensing.md`):** the operator is a **processor**. Before launch, provide a Data Processing Agreement (DPA), sub-processor list, EU data location and breach procedures.
- **Licence keys (Business edition):** verified offline; no instance or personal data is sent to the project. The key holds only the licensee's company name, features and dates.

## 2. GDPR / RGPD and LOPDGDD principles mapped to engineering

| Principle                      | Engineering requirement                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lawfulness, purpose limitation | Document the legal basis per data category (mostly contract and legal obligation, not consent). Don't reuse data for other purposes (e.g. no productivity profiling). |
| Data minimisation              | Collect only fields in `PRD.md`; optional fields hidden by default; no free-text medical details.                                                                     |
| Accuracy                       | Self-service updates; HR correction flows with history.                                                                                                               |
| Storage limitation             | Retention policies per category with enforcement jobs (section 5).                                                                                                    |
| Integrity and confidentiality  | RLS, encryption of sensitive columns, TLS, audit logs, least-privilege roles.                                                                                         |
| Accountability                 | Audit log, records of processing template (`docs/compliance/ropa-template.md`), DPIA template, ADRs.                                                                  |
| Transparency                   | Privacy notice template for employees; in-app notices where tracking occurs (clock-in, optional geolocation).                                                         |
| Data subject rights            | Access/portability export, rectification, erasure/anonymisation when no retention duty applies, restriction, objection handling workflow (ADM-004).                   |
| Breach notification            | Runbook: detect, assess, notify AEPD within 72 h when required; template in `docs/compliance/breach-runbook.md`.                                                      |
| Privacy by design/default      | Defaults off for geolocation; masked sensitive fields; no telemetry; no third-party assets.                                                                           |
| International transfers        | Default stack makes none; document any optional integration that would.                                                                                               |

Special-category data (GDPR art. 9) such as health, union membership, or disability: avoid storing. Absence **types** are coarse (e.g. "sick leave") with no diagnosis; access limited to HR roles; extra audit. A DPIA is recommended for the time-tracking and absence features.

## 3. Spanish labour rules that drive features (verify details)

- **Registro de jornada** - Estatuto de los Trabajadores (ET) art. 34.9 (added by RDL 8/2019): employers must keep a daily record of working time, including start and end time of each worker; records must be **kept for four years** and be available to workers, their legal representatives, and the Labour and Social Security Inspectorate.
  - **Pending change (as of Oct-Nov 2026):** a Real Decreto making the record **digital, verifiable and tamper-resistant, with remote access for the Inspectorate** was in processing; the Council of State issued an unfavourable, non-binding opinion in March 2026 and approval was repeatedly postponed. **Status must be re-checked before every release.** Our design (append-only events, hash chain, exports with content hash, auditor role) is intended to be compatible with these expected requirements. Do not market the product as "compliant with the digital registry" until the final regulation is published and reviewed.
  - **Limits of the tamper evidence (TIM-002).** Each event is HMAC-signed (keyed by `TIME_CHAIN_KEY`) and linked to the previous one by `seq` and `prev_hash`; the database refuses unsigned (v1) inserts, updates and deletes for the runtime role; a chain-head anchor (`time_event_chain_heads`) written in the same transaction makes a deleted tail detectable; and each `audit.verify-chain` run records every employee's head (ids, seq, hash) in `audit_log`, which the next run compares against. What it cannot prevent: a party with database owner or superuser rights (able to disable triggers and bypass RLS) **and** the chain key can rewrite rows, anchors and audit entries consistently. Without the key, forged or edited rows fail verification; without a surviving earlier verification record, a consistent rewind of rows plus anchor plus audit log made before the first run is undetectable. Keep the owner role and `TIME_CHAIN_KEY` out of the application's reach, and export verification reports (or database backups) to storage the operator cannot rewrite if external proof is required.
  - **Working-time exports (TIM-006).** `GET /v1/time/export` produces the record for one employee or for every employee employed during the period (`scope=organization`, organization-wide `time.record.read`: admin and auditor), as JSON, CSV or PDF, in Catalan, Spanish or English. Each row is one employee and local day: clock-in/out times, break, worked, expected and difference minutes, an anomaly flag (open session), a "corrected" flag (a TIM-003 correction touches that day), the TIM-002 chain status of that employee's records and an "employed" flag (the day falls inside one of the employee's employment periods; outside them nothing is expected, so the difference equals the recorded work, which is still listed, and no absence is implied); employees without a configured schedule on an employed day appear on a single flagged row. Each employee's days and clock times are in that employee's own time zone (location, else organization) in both scopes, named in a "time zone" column on every row, so the employee and organization documents never disagree (e.g. a Canary Islands employee of a Madrid organization). The organization scope lists everyone with an employment overlapping the period, without employment records and not terminated before it, or with time records in it (recorded work is never left out). Organization exports are capped at 50,000 employee-days (422 `EXPORT_TOO_LARGE`; export shorter periods) and each user is limited to 10 exports per minute (429). The header carries the organization, period, scope, the organization's time zone, generation time (UTC and local), the generating user (name and role) and an export id. No DNI/NIE or other identifiers beyond the name (data minimisation). The CSV is the canonical form: its last line is `# sha256=<hash>`, the SHA-256 of every byte before it. The download starts with a UTF-8 BOM that is **not** hashed, so `head -n -1 export.csv | sha256sum` gives a wrong result; verify with `tail -c +4 export.csv | head -n -1 | sha256sum` (macOS: `tail -c +4 export.csv | sed '$d' | shasum -a 256`). The PDF is not hashed itself: every page footer shows the export id and the CSV hash, and each export writes one `time.export` entry to `audit_log` (ADM-002) with the export id, scope, format, locale, period, employee count and hash (no names or emails), so an issued document can be traced to its content. The PDF uses the standard Helvetica fonts (not embedded) with Latin-1 text: characters outside it print as `?`.
  - **Inspector/auditor access (TIM-008).** The `auditor` role is read-only (organization-wide `time.record.read`, `org.read`, `audit.read`) and **time-limited**: every auditor membership has an access end date (enforced by a database constraint): the last day of access, read in the organization's time zone, required when the auditor is invited and set no later than the organization's **maximum access period** (`auditorAccessMaxDays`, configurable per organization from 1 to 366 days, **default 90**). Once the end date passes, the auditor's sessions, personal access tokens and new sign-ins are refused at lookup time (no background job). Admins list auditors, move the end date within the maximum, or revoke access immediately (which also deletes the auditor's sessions and tokens for the organization), and see and cancel pending auditor invitations, in Settings -> Inspector access. Revoking or shortening access expires the person's pending invitations, and an invitation older than the last access change is refused, so an old link cannot restore access. Each change is logged as `membership.access_update` (previous and new end date, revoked flag; no names or emails), invitations log the end date in `invitation.create`, changes to the maximum log `organization.security_updated`, and the auditor's reads of other employees' records log `inspector.*` entries. Lowering the maximum does not shorten access already granted. Auditors that existed before this feature were given 90 days from the upgrade (migration 0029).
- **Vacaciones** - ET art. 38: annual paid vacation per collective agreement or individual contract, never less than **30 calendar days**; cannot be replaced by money except on termination; scheduling rules and notice periods apply. Policies must be configurable (calendar vs working days, carry-over, local holidays).
- **Working-time limits and rest** - ET arts. 34-37: ordinary weekly cap (40 h annual average unless agreement states less), minimum rest between workdays (12 h), weekly rest, breaks for long days, overtime rules. Implement as configurable warnings, not hard blocks, unless the organization chooses to block.
- **Holidays** - national, autonomous community, and local; maintain per-location calendars annually, with a contribution process for community updates.
- **Digital rights at work** - LOPDGDD (Ley Organica 3/2018) arts. 87-91 (privacy with digital devices, **right to digital disconnection**, video surveillance, **geolocation** use must inform workers clearly and in advance). Therefore: geolocation optional, off by default, purpose-bound, transparent; notification settings support "quiet hours".
- **Equality and records** - salary registry and equality plans may apply to some companies; out of scope for v1.0 but keep data model extensible.
- **Whistleblowing channel** (Ley 2/2023) is out of scope; document as a possible future module.
- **Worker representatives** may need access to certain records; provide a role/export path.

## 4. Security expectations (maps to GDPR art. 32)

Encryption in transit (TLS 1.2+); at rest for sensitive columns and documents; strong password hashing; 2FA; session controls; backups encrypted; vulnerability management; access reviews; pentest before v1.0; secure SDLC (`REVIEW.md`).

## 5. Default retention schedule (configurable; confirm with counsel)

| Data                                                                                                  | Default retention                            | Notes                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Time records (`time_events`) and exports                                                              | >= 4 years                                   | Legal minimum; block deletion earlier.                                                                         |
| Employment contract and core HR record                                                                | Duration of employment + statutory periods   | Check labour, tax, and Social Security limitation periods.                                                     |
| Payslips / payroll documents                                                                          | Per tax and Social Security rules            | Often several years; make configurable.                                                                        |
| Leave requests and ledger                                                                             | Duration of employment + 4 years (suggested) | Supports disputes and audits.                                                                                  |
| Audit log                                                                                             | >= 3 years (suggested)                       | Security and accountability.                                                                                   |
| Recruitment data (future)                                                                             | 6-12 months unless consent                   | Out of v1.0.                                                                                                   |
| Rate-limit and lockout counters (`rate_limit_buckets`)                                                | Minutes (until the window or lockout ends)   | HMAC digests of IP/account keys: pseudonymised personal data, never clear values. The API sweeps expired rows. |
| Backups                                                                                               | <= 35 days rolling                           | Document erasure behavior in backups.                                                                          |
| After retention: anonymize or delete via `retention.enforce` job with dry-run report and audit entry. |

**Known gap (ADM-005 is report-only).** The `retention.enforce` worker job
runs daily per organization and produces a **dry-run report only**: it counts,
per category below, the rows past their period and writes one `retention.run`
audit entry per run (dates and counts only, no names, titles or file names).
It deletes and anonymises nothing, whatever the payload says. Until purging is
enabled, after counsel confirms the periods (issue #32):

- Documents deleted by users are soft-deleted (DOC-001): rows, versions and
  stored files are kept and hidden from the app, but never purged. This
  includes payslips and other sensitive documents.
- Soft-deleted documents still held are included in data-subject access
  exports (ADM-004), because GDPR art. 15 covers all data held.
- Nothing is anonymised or deleted when a retention period above ends; the
  report shows how much would be.

The only deletion that runs is instance-wide: `retention.sweep-global` deletes
password reset links (`password_reset_tokens`) older than their documented
30 days once per UTC day. Sessions are not swept.

**Retention configuration (ADM-005, report-only).** Periods are configuration
per organization: `retention_policies` (migration 0042) holds an optional
override per category, and a missing row means the default in
`packages/core/src/retention`. Every category is report-only: the daily
dry-run report counts eligible rows in the organization's time zone, and
nothing is deleted or anonymised. The defaults below are the maintainers' recommendation,
**pending legal confirmation by counsel** (issue #32); only the time-records
floor is law, and it is enforced by a database CHECK.

| Category              | Default (days)               | Measured from                       | Legal floor         |
| --------------------- | ---------------------------- | ----------------------------------- | ------------------- |
| `time_records`        | 1461 (4 years)               | the clock event                     | 1461 (ET art. 34.9) |
| `leave_records`       | 1461 (4 years)               | the employee's termination date     | none                |
| `audit_log`           | 1095 (3 years)               | the entry                           | none                |
| `deleted_documents`   | 30 (grace after soft delete) | the soft delete                     | none                |
| `statutory_documents` | 1461 (4 years)               | the upload (contracts and payslips) | none                |
| `notifications`       | 365                          | the notification                    | none                |
| `invitations`         | 90                           | acceptance or expiry                | none                |

A soft-deleted contract or payslip counts as eligible (under
`deleted_documents`) only once both its `deleted_documents` grace and its
`statutory_documents` period have passed. `statutory_documents` is a hold,
never a basis for deletion: the report gives it `eligible: 0` and lists the
soft-deleted contracts and payslips it still holds back as `heldBack`. Password reset links
(`password_reset_tokens`, instance-wide, not per organization) keep their
30-day retention of migration 0040, enforced daily by `retention.sweep-global`.

## 6. Feature-level compliance requirements

- **Time tracking:** append-only events, corrections referenced not overwritten, 4-year retention, exports with hash, employee access to own records, optional inspector role with time-limited (default 90 days, configurable per organization), logged access, employee notified of corrections.
- **Geolocation (optional):** per-location opt-in; purpose text; employee notice on first use; capture only at clock events; no background tracking; separate retention; DPIA required.
- **Documents:** payslip-type docs restricted to employee/payroll; downloads audited; no third-party previews.
- **Vacation carry-over and expiry (LEA-002):** losing days is **off by default**. Each leave policy has `carryover_enforced` (default false): while it is off, the year-end close carries the whole remaining balance over and nothing is ever forfeited or expired, so `carryover_max_days` and `carryover_expiry_months` have no effect. An administrator may turn it on per policy (audited) after checking the collective agreement; the close then carries over at most `carryover_max_days`, forfeits the rest, and expires carried days not used by the end of month `carryover_expiry_months` of the next year (the date is fixed at the close). See `docs/guides/leave-accrual.md`.
  - **ET art. 38.3 protection, always on:** vacation that could not be taken because of temporary incapacity, pregnancy (including risk during pregnancy), birth, adoption or breastfeeding may be taken after that leave ends (for incapacity, up to 18 months after the end of the year in which it accrued). Even with enforcement on, an employee with approved leave of such a type in the year being closed or the year before keeps their whole balance (carried over without an expiry date), and an employee with such leave between 1 January and the expiry date keeps their carried days. Protected days are therefore not lost at the two closes after the protected leave (covering the 18 months of incapacity); after that the cap applies again, and leave approved after a close ran is not taken into account (HR restores those days with an adjustment). Leave types expose only a code, so protection uses a cautious rule (`protectsVacation` in `packages/core`): protected codes (`sick_leave`, `birth_childcare`, `prenatal_exams`, `pregnancy_risk`, `maternity`, `paternity`, `adoption`, `breastfeeding`, ...), plus any leave type that is not an entitlement of the employee and whose code is not a known ordinary permit. The worker logs a neutral "statutory exemption" warning with ids only and counts it in the job report; it never records which protected leave applied.
  - EU case law also limits forfeiture when the employer did not enable the leave to be taken; LibreHR does not track that, which is one more reason enforcement is opt-in. Counsel should review before v1.0 (§7).
- **Absences:** no diagnoses; attachments (e.g. medical certificate) stored encrypted, visible only to HR roles, retained minimal time.
- **Exports/reports:** permissioned and audited; include watermark/metadata (who/when).
- **Notifications:** emails avoid sensitive details (no leave type or reason in subject/body unless the recipient is entitled).
- **Employee notices:** admin settings include editable text templates (ca/es/en) for privacy notice and clock-in notice.

## 7. Compliance review checklist before v1.0 (owner: maintainers)

- [ ] Lawyer review: labour (registro de jornada, vacation defaults) and data protection (RoPA, DPIA, notices).
- [ ] Re-check status of digital working-time registry regulation and adapt TIM requirements.
- [ ] Security review/pentest; RLS isolation report; dependency and SBOM review.
- [ ] Data-subject request drill (export + anonymize) on sample data.
- [ ] Breach runbook rehearsed; security contact published.
- [ ] Clean-room audit (`CLEANROOM.md`), license audit, trademark clearance of name/logo.
- [ ] Accessibility audit (WCAG 2.2 AA).

## 8. Keeping this document current

Add a dated entry to `docs/compliance/changelog.md` whenever a rule, default, or interpretation changes, link the source, and open issues for affected requirements.
