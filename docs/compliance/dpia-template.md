# Data Protection Impact Assessment (DPIA) Template

_(Article 35 GDPR - High-Risk Processing & Employee Monitoring)_

**System:** LibreHR Human Resources Information System  
**Organization:** [Organization Name]  
**Lead Evaluator:** [DPO or Security Officer]  
**Date of Assessment:** 2026-11-01

---

## 1. Description of the Processing

LibreHR processes personal and employment data of employees for workforce management, leave requests, and legally mandated time tracking (registro de jornada).

### Scope and Boundaries

- **Employee Monitoring:** LibreHR records entry and exit timestamps. It **does not** perform keystroke logging, screen capture, continuous webcam surveillance, or real-time GPS tracking.
- **Biometric Ban:** In compliance with the AEPD Guide on Biometric Control (Nov 2023), biometric authentication (fingerprints, facial recognition) is prohibited. Authentication is password-based with optional WebAuthn security keys.
- **Special Category Data:** Health diagnoses are banned. Only coarse absence classifications (`sick_leave`, `maternity`) are stored.

## 2. Assessment of Necessity and Proportionality

- **Registration of Jornada:** Required by Spanish Law (RDL 8/2019). The data captured (timestamp, event type) is strictly minimal to satisfy the legal obligation.
- **Tamper Evidence:** Append-only ledger with cryptographic hash chaining ensures data integrity without excessive surveillance.
- **Granular Authorization:** Managers only see time tracking and leave records for direct reports (`scope = reports`). Co-workers cannot view absence reasons.

## 3. Risk Identification and Mitigation Measures

| Risk Description                                               | Severity | Likelihood | Mitigation Measure                                                                                                            | Residual Risk |
| -------------------------------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Unauthorized cross-tenant access to sensitive employee records | Critical | Low        | PostgreSQL Row-Level Security (RLS) forced on all tables; transaction-scoped session context; comprehensive integration tests | Very Low      |
| Exposure of sensitive personal identifiers (DNI/NIE, IBAN)     | High     | Medium     | AES-256-GCM envelope encryption at rest; UI masked by default with audited click-to-reveal                                    | Low           |
| Tampering with time records during labor inspection            | High     | Low        | Append-only event table; corrections reference original event; SHA-256 hash chaining                                          | Very Low      |
| Accidental retention beyond statutory deadlines                | Medium   | Medium     | Automated pg-boss worker job (`retention.enforce`) executing deletion policies after 4 or 5 years                             | Low           |

## 4. DPO Opinion & Approval

The DPO has reviewed LibreHR's architecture, including its zero-telemetry policy, self-hosted deployment options, and strict RLS isolation. The system is deemed compliant with GDPR and LOPDGDD.
