# Record of Processing Activities (ROPA) Template

_(Article 30 GDPR - General Data Protection Regulation)_

**Controller:** [Organization Name]  
**DPO / Privacy Contact:** [dpo@company.com]  
**Last Updated:** 2026-11-01

---

## 1. Employee Management & Personnel Records

- **Purpose:** Administration of employment contracts, payroll preparation, organizational hierarchy.
- **Legal Basis:** GDPR Art. 6(1)(b) (Performance of contract), Art. 6(1)(c) (Legal obligation).
- **Categories of Data Subjects:** Current employees, former employees, contractors.
- **Categories of Personal Data:** Full name, contact details, DNI/NIE/SSN, bank details (IBAN), job title, manager, salary tier, emergency contacts.
- **Recipients:** Internal HR, payroll advisors, social security & tax authorities (TGSS, AEAT).
- **Retention Period:** 5 years post-termination (Spanish labor statute of limitations: Real Decreto Legislativo 5/2000, LISOS).
- **Technical & Organizational Measures:** AES-256-GCM envelope encryption for sensitive fields, PostgreSQL Row-Level Security, role-based access control, tamper-evident audit logs.

## 2. Working-Time Tracking (Registro de Jornada)

- **Purpose:** Mandatory recording of daily working hours under Spanish Law (Real Decreto-ley 8/2019, Estatuto de los Trabajadores art. 34.9).
- **Legal Basis:** GDPR Art. 6(1)(c) (Legal obligation).
- **Categories of Personal Data:** Employee ID, timestamp of clock-in/out, source channel (web, mobile), correction justifications, SHA-256 event hash chain.
- **Recipients:** Labor inspection (ITSS), workers' representatives (RLT), employee.
- **Retention Period:** Exactly 4 years as mandated by art. 34.9 ET.
- **Biometric / Geolocation Warning:** No biometric data (fingerprint, facial recognition) processed. Geolocation is strictly coarse/disabled by default.

## 3. Leave & Absence Management

- **Purpose:** Vacation scheduling, leave accrual, tracking statutory and medical leaves.
- **Legal Basis:** GDPR Art. 6(1)(b) & Art. 6(1)(c); Art. 9(2)(b) (Employment & social security law).
- **Categories of Personal Data:** Absence start/end dates, absence category (vacation, sick leave, maternity/paternity). _Note: Medical diagnoses or detailed health data are strictly prohibited and never stored._
- **Recipients:** Employee, direct manager, HR department, labor/social security authorities.
- **Retention Period:** 5 years.
