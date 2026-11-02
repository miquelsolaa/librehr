# Compliance and Legal Changelog

All legal and regulatory revisions affecting LibreHR are tracked here.

## [2026-11-01] - Milestone M0 Baseline

- **GDPR / LOPDGDD:** Established strict multi-tenant Row-Level Security, AES-256-GCM envelope encryption for sensitive attributes, and structured audit logging.
- **Registro de Jornada (Spanish Working-Time Law):** Implemented append-only `time_events` with SHA-256 hash chaining, immutable event records, and 4-year retention compliance.
- **Biometric Ban:** Audited authentication architecture to ban all biometric processing in alignment with AEPD 2023 Guidelines.
- **Labor Health Diagnoses:** Implemented prohibition against storing medical reasons; restricted to coarse absence classifications.
