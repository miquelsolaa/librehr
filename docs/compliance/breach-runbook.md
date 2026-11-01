# Data Breach Response Runbook (GDPR Art. 33 & 34)

## 1. Overview and 72-Hour Mandate

Under GDPR Article 33, any personal data breach presenting a risk to the rights and freedoms of individuals must be notified to the competent supervisory authority (e.g. AEPD in Spain, APDCAT in Catalonia) **within 72 hours** of becoming aware of it.

If the breach presents a **high risk**, affected individuals must also be notified without undue delay (Art. 34).

---

## 2. Incident Response Team & Responsibilities

- **Incident Commander (Lead):** Coordinates technical investigation and containment.
- **Data Protection Officer (DPO):** Assesses risk to data subjects, drafts legal notifications, liaises with authorities.
- **Lead DevOps / Backend Engineer:** Isolates compromised infrastructure, pulls audit logs, analyzes blast radius.
- **Legal & Communications Officer:** Prepares internal and external notifications.

---

## 3. Step-by-Step Response Timeline

```
[ Hour 0 - Discovery ]
       │
       ▼
[ Hour 0 to 4: Containment & Triage ]
  • Isolate affected containers / services.
  • Invalidate active sessions and rotate database credentials.
  • Identify affected tenant(s) and data classes involved.
       │
       ▼
[ Hour 4 to 24: Forensic Analysis & Assessment ]
  • Query OpenHR tamper-evident audit logs (`audit_log` table) using transaction IDs.
  • Determine exact number of compromised records and whether encrypted fields (DNI, IBAN) were decrypted.
  • DPO conducts risk severity assessment using ENISA methodology.
       │
       ▼
[ Hour 24 to 72: Authority Notification ]
  • If risk exists, submit initial notification to AEPD via electronic headquarters (Sede Electrónica).
  • Form includes: Nature of breach, categories and approx. number of data subjects, likely consequences, measures taken or proposed.
       │
       ▼
[ Post-72 Hours: Remediation & Individual Notification ]
  • If high risk: Notify affected employees with clear, plain-language description and guidance.
  • Publish root cause analysis (RCA) and implement architectural safeguards.
```

---

## 4. OpenHR Forensic Investigation Queries

In the event of suspected unauthorized access, run the following queries under an isolated forensic database session:

```sql
-- Identify all queries on sensitive employee records during incident window
SELECT * FROM audit_log
WHERE resource_type = 'employee'
  AND action IN ('employee:read_sensitive', 'employee:read')
  AND created_at BETWEEN '2026-11-01 00:00:00Z' AND '2026-11-01 23:59:59Z'
ORDER BY created_at ASC;

-- Verify hash chain integrity for time tracking
SELECT * FROM time_events WHERE organization_id = :org_id ORDER BY sequence_number ASC;
```
