# Compliance and Legal Changelog

All legal and regulatory revisions affecting LibreHR are tracked here.

## [2026-11-27] - Background working-time exports (`TIM-006`, issue #38)

- **Asynchronous export path (`TIM-006`):** organization exports above the synchronous cap of 50,000 employee-days, up to 500,000, are queued (`POST /v1/time/exports`) and built by the worker with the same builder, so the document and its SHA-256 hash match the synchronous export for the same data. Each build writes the same ADM-002 `time.export` audit entry, marked `delivery: "async"`.
- **New retention default:** the stored export file can be downloaded for 7 days (`TIME_EXPORT_FILE_TTL_HOURS`, 1-720 hours) and is then deleted. Only this download copy expires: the `time_exports` record (id, period, requester, hash) and the audit entries are kept for at least 4 years, like the working-time records themselves (Real Decreto-ley 8/2019, `TIM-007`).
- **Access logging (`TIM-008`):** only the requester can download an export, and only while they still hold organization-wide `time.record.read` (a lapsed auditor window ends access); every download writes a `time.export.download` audit entry with the export id, format and hash only.
- **Storage and encryption stance:** the file is stored in the database (`time_export_files`) under row-level security, readable only through the requester's download, and is not encrypted at the application level: it holds names and working times but no special-category data, the same data the database already holds. Operators should encrypt the database disk and backups. Failed or stalled exports notify the requester and store nothing.

## [2026-11-02] - Milestone M5: Integrations, Token Security & Hash Chain Verification

- **Token Security & Scoping (`ADM-006`):** Personal Access Tokens (PATs) use high-entropy prefixing (`lhr_`), one-way SHA-256 storage, and strict scope verification, preventing credential leakage in compliance with ISO/IEC 27001 access control requirements.
- **Continuous Tamper-Evidence Verification (`TIM-002`):** Automated background worker job runs cryptographic hash chain integrity audits across all historical time tracking events to detect and flag anomalies for Labour Inspection compliance.
- **Gestoría Payroll Data Minimization (`RPT-002`):** Gestoría export strictly contains aggregated working days, statutory leaves, and overtime, omitting unauthorized personal and special category data.
- **iCalendar Anonymization (`LEA-009`):** Calendar subscription feeds disclose only presence vs absence statuses and statutory holidays, protecting employee privacy from public disclosure.

## [2026-11-02] - Milestone M4: Documents, Payslips & GDPR Subject Access Requests

- **GDPR Article 15 (Right of Access / DSR):** Implemented automated Data Subject Request export (`GET /v1/people/:id/dsr-export`) packaging all personal data, contracts, time records, and leave ledgers into a secure zip archive.
- **Confidential Document Storage (`DOC-001`):** Applied fine-grained tenant and user ACLs to document repository with envelope-encrypted storage references.
- **Spanish Payslip Distribution (`DOC-004`):** Bulk distribution parses and verifies NIF/NIE before delivering individual payslips, preventing cross-employee data exposure.

## [2026-11-02] - Milestone M3: Registro de Jornada & Labour Inspection Safeguards

- **Real Decreto-ley 8/2019 Compliance (`TIM-001` - `TIM-006`):** Immutable daily working time registration, non-destructive correction workflows with mandatory justifications, and official four-year retention inspection reports.
- **Anti-Surveillance & Digital Disconnection:** Banned continuous keystroke logging, screen monitoring, or automated GPS tracking in strict adherence to Article 88 LOPDGDD (Right to Digital Disconnection).

## [2026-11-01] - Milestone M2: Statutory Leave & Holiday Calendars

- **Estatuto de los Trabajadores Alignment (`LEA-001` - `LEA-006`):** Integrated non-deductible statutory leaves (permisos retribuidos: matrimonio, fallecimiento, mudanza) and regional Spanish holiday calendars (Catalonia, Madrid, Andalusia, Valencia, Basque Country, Galicia, Balearic Islands).
- **Append-Only Leave Ledger (`LEA-002`):** Complete traceability of leave balances preventing silent mutations or undocumented deductions.

## [2026-11-01] - Milestone M1: Role-Based Authorization & Setup

- **Principle of Least Privilege (`AUTH-002`):** Multi-tiered role separation (admin, HR manager, team manager, employee) strictly restricting access to employee data.
- **Data Minimization:** Restricted employee profiles to necessary employment attributes; medical diagnoses strictly prohibited.

## [2026-11-01] - Milestone M0 Baseline

- **GDPR / LOPDGDD:** Established strict multi-tenant Row-Level Security, AES-256-GCM envelope encryption for sensitive attributes, and structured audit logging.
- **Registro de Jornada (Spanish Working-Time Law):** Implemented append-only `time_events` with SHA-256 hash chaining, immutable event records, and 4-year retention compliance.
- **Biometric Ban:** Audited authentication architecture to ban all biometric processing in alignment with AEPD 2023 Guidelines.
- **Labor Health Diagnoses:** Implemented prohibition against storing medical reasons; restricted to coarse absence classifications.
