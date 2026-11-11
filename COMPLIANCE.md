# COMPLIANCE.md - Legal and regulatory guide for engineers

> Engineering guidance, **not legal advice**. Verify against current sources (BOE, EUR-Lex, AEPD, Ministerio de Trabajo) and have a labour/data-protection lawyer review before v1.0 and before each release that changes defaults. Last reviewed: 2026-11-01. Update this file whenever regulation changes.

## 1. Roles under GDPR

- **Self-hosted:** the customer company is the **data controller**; the project is software only. Provide docs to help them meet obligations.
- **If a hosted offering exists later:** the operator is a **processor**; provide a Data Processing Agreement (DPA), sub-processor list, and breach procedures.

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

| Data                                                                                                  | Default retention                            | Notes                                                      |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Time records (`time_events`) and exports                                                              | >= 4 years                                   | Legal minimum; block deletion earlier.                     |
| Employment contract and core HR record                                                                | Duration of employment + statutory periods   | Check labour, tax, and Social Security limitation periods. |
| Payslips / payroll documents                                                                          | Per tax and Social Security rules            | Often several years; make configurable.                    |
| Leave requests and ledger                                                                             | Duration of employment + 4 years (suggested) | Supports disputes and audits.                              |
| Audit log                                                                                             | >= 3 years (suggested)                       | Security and accountability.                               |
| Recruitment data (future)                                                                             | 6-12 months unless consent                   | Out of v1.0.                                               |
| Backups                                                                                               | <= 35 days rolling                           | Document erasure behavior in backups.                      |
| After retention: anonymize or delete via `retention.enforce` job with dry-run report and audit entry. |

**Known gap (ADM-005 not yet implemented).** The `retention.enforce` worker job
is a stub that fails loudly (dead-letters with "not implemented") instead of
reporting success. Until ADM-005 ships:

- Documents deleted by users are soft-deleted (DOC-001): rows, versions and
  stored files are kept and hidden from the app, but never purged. This
  includes payslips and other sensitive documents.
- Soft-deleted documents still held are included in data-subject access
  exports (ADM-004), because GDPR art. 15 covers all data held.
- Nothing is anonymised or deleted when a retention period above ends.

Implementing ADM-005 is the next required feature. Its retention periods are
compliance defaults, so the maintainers must confirm them (with counsel)
before it ships.

## 6. Feature-level compliance requirements

- **Time tracking:** append-only events, corrections referenced not overwritten, 4-year retention, exports with hash, employee access to own records, optional inspector role with time-limited (default 90 days, configurable per organization), logged access, employee notified of corrections.
- **Geolocation (optional):** per-location opt-in; purpose text; employee notice on first use; capture only at clock events; no background tracking; separate retention; DPIA required.
- **Documents:** payslip-type docs restricted to employee/payroll; downloads audited; no third-party previews.
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
