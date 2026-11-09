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

## 6. Feature-level compliance requirements

- **Time tracking:** append-only events, corrections referenced not overwritten, 4-year retention, exports with hash, employee access to own records, optional inspector role with logged access, employee notified of corrections.
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
