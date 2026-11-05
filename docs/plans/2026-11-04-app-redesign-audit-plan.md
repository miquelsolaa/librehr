# LibreHR application redesign: audit and delivery plan

**Status:** Proposed; source audit only, 2026-11-04. This is not evidence that every screen works. Secondary research was supplied on 2026-11-04 and summarized in `UX_RESEARCH.md`; its claims are not independently verified and it contains no primary user research. `PERSONA.md` calls its personas fictional. Validate proposed journeys with representative users before treating the UX as validated.

**Goal:** Make everyday HR tasks understandable, trustworthy and usable on mobile and desktop, while preserving privacy, accessibility and existing behavior.

**Approach:** Retain Next.js, the shared UI package, semantic tokens, translations and API authorization. Deliver small, independently tested vertical slices. Adopt the requirements in the supplied screen inventory as targets, mapping each screen and action to a PRD ID before implementation. Where that inventory and the current PRD or compliance documents disagree, resolve the conflict before building.

## Evidence and immediate risks

- `apps/web/src/app/[locale]/(app)/time-off/page.tsx`: a successful empty request list is replaced with sample requests; failed balance retrieval is replaced with a sample balance. This can misrepresent real HR data.
- `apps/web/src/app/[locale]/(app)/people/page.tsx`, `reports/page.tsx`, and `apps/web/src/components/notification-bell.tsx`: failed requests can display sample records or notifications as if real. Review all imports of `mock-data.ts` and offline fallbacks for the same issue.
- `apps/web/src/app/[locale]/(app)/layout.tsx`: the organization, initial user and role label are hard-coded; all non-auditor roles share navigation; mobile navigation takes only the first three links, omitting the specified clock, documents and profile destinations.
- `apps/web/src/components/notification-bell.tsx`: read failures are silently ignored and “Mark all read” is hard-coded English. `reports/page.tsx` only logs export failures; clock and leave cancellation use browser alerts.
- Current routes include `/people/org-chart`, `/time/export`, and `/kiosk`, while the supplied inventory names other paths. Preserve existing links and add redirects or aliases only after mapping each route and checking its behavior.
- `apps/web/e2e/a11y.spec.ts` scans home and sign-in only; smoke tests establish a shell at two viewport sizes, not coverage of every screen, role, state or data-changing action.
- Docker was unavailable during this audit, and the web server did not respond at localhost:3000. Findings above are source observations, not browser-reproduced defects. All other screens and interaction states remain unverified.

## Direction

Use LibreHR's existing calm pine-and-neutral design language and original assets. Improve hierarchy with clear page questions, a single prominent next action, explainable numbers, readable tables and consistent status text. Prioritize employee tasks at 360px; provide accessible navigation to all permitted destinations for administrative roles. Use existing self-hosted fonts, tokens and components; avoid ornamental animation, remote assets and decorative complexity. Validate light/dark contrast, keyboard interaction and reduced motion. The design direction is a hypothesis until tested with users.

## Delivery sequence and acceptance gates

### 0. Research, inventory and baseline

- [x] Record the supplied secondary research and distinguish its findings from hypotheses.
- [ ] Map the supplied SCR IDs to PRD IDs, current route, role, API, dependencies and evidence. Flag IDs absent from PRD and screens without IDs; validate the proposed journeys with representative users.
- [ ] Start isolated development infrastructure and use synthetic data; capture desktop and 360px screenshots and test each existing route, plus direct navigation, empty, loading, failure, forbidden and offline states. Record reproducible defects and classify missing routes separately from broken ones.
- [ ] Capture baseline Playwright, axe, keyboard and browser-console results for ca/es/en and representative EMP, MGR, HR/OWN, PAY and AUD permissions. Verify server-side scope and tenant isolation separately from navigation visibility.

### 1. Trust and recovery

- [ ] Replace implicit mock fallbacks across people, org chart, leave, reports and notifications with explicit loading, empty, partial, unauthorized and retryable error states. Sample data is permitted only in an explicitly labeled isolated demo mode.
- [ ] Write regression tests proving a successful empty leave list stays empty, API failures never display fabricated balances or employees, and a retry can recover. Test 401/403 distinctly and avoid exposing sensitive error details.
- [ ] Replace silent failures and browser alerts with translated, accessible feedback; retain form input on errors and prevent duplicate submissions. Test failure and recovery for clock, leave cancellation, notifications and exports.

### 2. Shared shell and design foundations

- [ ] Replace hard-coded identity and organization display with verified session/organization data and a neutral loading state. Show only permitted destinations based on server-provided capabilities; keep API authorization authoritative.
- [ ] Design role-aware desktop navigation and mobile navigation with access to all required employee destinations and an accessible overflow for other permitted sections. Test keyboard, focus, active route, 360px width, locale switching and long translated labels.
- [ ] Improve existing tokens, typography, forms, status indicators, empty/error components and tables in `packages/ui`; document states in Storybook. Preserve semantic contrast, tabular numbers and reduced-motion support.

### 3. Employee daily work

- [ ] Redesign home, time clock, timesheet, time off, leave request, documents and tasks around the next action and clear status. Explain time and leave totals from their real sources; never imply a successful write before the API confirms it.
- [ ] Exercise clock in/out and breaks, correction requests, leave submission/cancellation and document access with success and failure tests. Include half days, time zones, expired sessions, offline behavior and retries.

### 4. Managers and people

- [ ] Build or revise approvals, team calendar, directory, profile and org chart as scoped workflows. Show only data allowed by the API and use consistent request and person components. Test role, direct-report and cross-tenant boundaries, including masked fields and audited reveals where applicable.
- [ ] Verify search, filters, no-results, table responsiveness, editing and navigation to profiles. Document any unimplemented inventory actions explicitly instead of presenting nonfunctional controls.

### 5. Administration and remaining inventory

- [ ] Review setup, onboarding, reports, exports, settings, privacy, security, auditor and platform screens against the inventory and PRD; split missing capabilities into small work items with contracts and dependencies. Preserve legal defaults and existing audit, encryption and RLS protections.
- [ ] Test each data-changing workflow for success and failure, permission and cross-tenant isolation; verify file export integrity and accessible feedback. Keep auditor access scoped and read-only.

### 6. Release audit

- [ ] Maintain a route/action/state matrix: each screen has a named test or manual evidence for loading, populated, empty, error, forbidden and offline states; each interactive action has a verified outcome. Cover ca/es/en, both themes, desktop and 360px, keyboard and axe.
- [ ] Run `pnpm verify` with Docker available, plus `pnpm test:e2e`; resolve failures and review all skipped integration tests. Document any unresolved issue rather than asserting every screen works.
- [ ] Update design documentation, translations, relevant PRD traceability and release notes. Review clean-room, privacy, tenancy and accessibility requirements per slice.

## Implementation notes (in progress)

- The home, navigation, time, time-off, people, organization chart, documents and onboarding views now distinguish a failed load from a genuine empty result. Browser coverage uses isolated synthetic API responses; this does not establish correctness of every endpoint, role or screen.
- RPT-001 summary and RPT-002 gestoria export are temporarily unavailable in the UI and API. The existing report repository references nonexistent time and employment columns, uses hard-coded working-day and leave-type assumptions, and treats encrypted identifiers as exportable values. Their previous implementation used fixed employment dates, a fixed working-day count and placeholder payroll fields, and has not been validated for scoped access or correct period accounting. Restore these features only with real, permission-scoped data, accurate date and time calculations, and integration tests. Their temporary HTTP 503 responses are documented in OpenAPI.
- The calendar feed download is not offered on the reports screen. Calendar JSON and ICS now mask leave types for unrelated managers and colleagues, and tests cover direct reports and cross-tenant results; broader within-organization visibility scopes still require review.
- Location creation selects an existing legal entity or creates the first one; the API rejects entities belonging to another organization and audits creation.
- Departments now require an explicitly configured coverage percentage; timesheets require explicit schedule rules. Administrators can configure both, but editing or closing existing schedule assignments remains outstanding.
- The complete route and role matrix, the remaining settings and administrative workflows, primary usability research and database-backed isolation checks remain outstanding. Do not mark this plan complete on the basis of browser smoke tests.

## Dependencies and open decisions

The screen inventory describes a multi-release effort, including capabilities absent from the current route tree. Screen UX should be validated by representative employees, managers and HR administrators. The previous request authorized security-sensitive work, but implementation must still respect the repository's legal and clean-room constraints. Existing uncommitted work in the workspace is outside this plan and must be preserved.
