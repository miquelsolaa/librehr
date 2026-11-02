# PERSONA.md

Personas used to drive product, design, and agent decisions. They are **fictional composites** based on typical SMB scenarios in Spain; replace or refine them with real user research and record changes in git.
Agents: when a requirement is ambiguous, choose the option that best serves the primary persona for that flow and say which persona you optimized for.

---

## P1 - Marta, People & Operations Manager (primary admin)

- **Context:** 60-person company in Barcelona (services). Manages HR part-time next to finance/admin. Works on a desktop, Excel-literate, not technical. Responsible to management and to the external gestoria.
- **Jobs to be done:** keep employee records correct; approve and track vacations; ensure working-time records are compliant; send documents (payslips, certificates); onboard new hires smoothly; prepare monthly data for the gestoria.
- **Frustrations:** chasing managers by email; balances that don't match; fear of an Inspection visit; duplicated data entry; tools that need a consultant to configure.
- **Needs:** safe defaults, clear wizards, bulk import, explainable balances, audit trail, exports that "just work", strong permissions.
- **Success looks like:** closes month-end HR tasks in < 1 hour; no balance disputes; confident during an inspection.
- **Design implications:** dense but legible tables, bulk actions, undo/confirm for destructive steps, inline help in Catalan/Spanish.

## P2 - Jordi, Founder who also does HR (secondary admin)

- **Context:** 12-person agency in Terrassa. Does everything; wants zero admin overhead. Comfortable with SaaS, maybe with Docker.
- **Jobs:** set up quickly; let people request vacation and clock in; know who is away; stay legal.
- **Frustrations:** per-seat pricing; complex features he doesn't need; losing time to configuration.
- **Needs:** 5-minute setup, templates for Spanish defaults, a single dashboard "what needs my attention".
- **Design implications:** progressive disclosure; sensible presets (e.g. "Spain - Catalunya 2026"); advanced options hidden until needed.

## P3 - Laia, Employee (primary end user)

- **Context:** 29, works hybrid, phone-first for quick things. Not interested in HR tools; wants to do her task and leave.
- **Jobs:** clock in/out; request time off; see her balance and team calendar; download payslips; update her phone/address.
- **Frustrations:** not knowing her remaining days; waiting for approval without feedback; forgetting to clock out; logging in repeatedly.
- **Needs:** one-tap clocking, clear status of requests, notifications she controls, readable on 360 px screens.
- **Success looks like:** any common task in < 30 seconds.
- **Design implications:** mobile-first, large touch targets (>= 44 px), persistent session with re-auth for sensitive actions, forgiving corrections flow.

## P4 - Pere, Team Manager (approver)

- **Context:** leads a team of 8; busy; approves requests between meetings, often from his phone.
- **Jobs:** approve/reject leave quickly with team context; see who is away; fix his team's forgotten clock-outs; onboard a new team member.
- **Frustrations:** approving without seeing coverage; email-only notifications; unclear responsibilities.
- **Needs:** approval inbox, coverage warnings, one-click approve with optional comment, delegate while on holiday.
- **Design implications:** actionable notifications (deep links), approval cards showing conflicts and balance impact.

## P5 - Nuria, External gestora / payroll advisor

- **Context:** advisor at a gestoria serving 30 SMBs. Needs reliable monthly inputs; limited access to client systems.
- **Jobs:** obtain absences, overtime, new hires and leavers per month; check data consistency; keep a record for audits.
- **Frustrations:** inconsistent formats; late changes; no history of modifications.
- **Needs:** a scoped **Payroll** role, configurable export templates, change history, stable identifiers.
- **Design implications:** column-mapping exports, immutable monthly "close" snapshots, read-only access by default.

## P6 - Sam, Self-hoster / IT admin

- **Context:** sysadmin or developer at the company, or at a public body/association, who must keep data in-house.
- **Jobs:** deploy, back up, upgrade, monitor, integrate SSO, secure.
- **Frustrations:** undocumented env vars, breaking upgrades, no health checks, unclear data locations.
- **Needs:** single-command deploy, `.env.example` with comments, health endpoints, migration safety, backup/restore docs, upgrade notes per release.
- **Design implications:** excellent `infra/` and `docs/`, boring tech (Postgres, SMTP, S3), semantic versioning, `librehr doctor (pnpm doctor)` CLI check.

## P7 - Alex, Open-source contributor

- **Context:** TypeScript dev (or AI-assisted) who wants to fix a bug or add a holiday calendar for their region in an evening.
- **Needs:** < 10 min to a running dev environment, fast tests, labelled issues, clear architecture, translation workflow.
- **Design implications:** `pnpm dev` just works, seed data, strong conventions in `AGENTS.md`, small modules.

## P8 - Inspector / Auditor (read-only, rare)

- **Context:** Labour Inspectorate official or internal/external auditor who needs time-limited access to working-time records.
- **Needs:** read-only access scoped to records and exports, verifiable integrity (hash chain, export hashes), access logged.
- **Design implications:** separate role, expiring access links, no navigation to unrelated HR data.

---

## Anti-personas (do not optimize for)

- Large enterprises (> 2,000 employees) needing complex matrix org and payroll engines.
- Teams wanting surveillance/productivity monitoring (screenshots, keystrokes, continuous location). The product will not provide it.

## Accessibility and context notes

- Some users have low digital literacy, older devices, or visual impairments; target WCAG 2.2 AA, test with keyboard and screen reader.
- Languages: Catalan, Spanish, English. Many workplaces are bilingual; users choose their own language independently of the organization's default.
- Shared/kiosk devices exist (retail, workshop): support PIN/QR clocking without personal accounts on the device.

## Persona -> module priority matrix

| Module          | Marta | Jordi | Laia | Pere | Nuria | Sam  |
| --------------- | ----- | ----- | ---- | ---- | ----- | ---- |
| Employees/Org   | High  | Med   | Low  | Med  | Med   | Low  |
| Time off        | High  | High  | High | High | Med   | Low  |
| Time tracking   | High  | High  | High | Med  | Med   | Low  |
| Documents       | High  | Med   | High | Low  | Med   | Low  |
| Onboarding      | High  | Med   | Med  | Med  | Low   | Low  |
| Reports/Exports | High  | Med   | Low  | Med  | High  | Low  |
| Admin/Security  | Med   | Med   | Low  | Low  | Low   | High |
