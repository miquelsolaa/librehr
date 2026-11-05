# Functionality and screen coverage

This is an inventory of the current checkout, not a claim that every requirement
or workflow is complete. A route being present means its screen or endpoint has
been implemented; it does not establish that every action, role, error state,
locale, or accessibility requirement has been verified. `PRD.md` describes the
target product; this document describes what exists today. The redesign audit and
its outstanding work are tracked in
[the redesign plan](plans/2026-11-04-app-redesign-audit-plan.md).

All web paths below have a locale prefix (`/ca`, `/es`, or `/en`). Actions are
subject to the API's permissions, tenant scope, and configuration. Screenshots in
the README use fictional data and do not demonstrate a live integration.

## Web screens present

| Screen                | Route after locale        | Functionality present / qualification                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in               | `/sign-in`                | Email and password sign-in.                                                                                                                                                                                                                                                                                                  |
| First-run setup       | `/setup`                  | Organization setup form; not the complete seven-step target wizard.                                                                                                                                                                                                                                                          |
| Invitation            | `/invite/[token]`         | View and accept an invitation.                                                                                                                                                                                                                                                                                               |
| Home                  | `/home`                   | Clock and overview cards, using account data when available.                                                                                                                                                                                                                                                                 |
| People                | `/people`                 | Employee directory and invitation flow.                                                                                                                                                                                                                                                                                      |
| Employee              | `/people/[id]`            | Profile and selected actions including self-service, emergency contacts, custom fields, termination, sensitive-field reveal and kiosk PIN. **Known risk:** on load failure this page can show mock profile or emergency-contact data; it must not be relied on until corrected. Does not implement every target profile tab. |
| Organization chart    | `/people/org-chart`       | Reporting hierarchy.                                                                                                                                                                                                                                                                                                         |
| Time off              | `/time-off`               | Balances and requests, with cancellation where permitted.                                                                                                                                                                                                                                                                    |
| Request time off      | `/time-off/request`       | Leave request form; coverage and schedule configuration can block submission.                                                                                                                                                                                                                                                |
| Team absence calendar | `/time-off/calendar`      | Calendar view with scope-aware leave type visibility.                                                                                                                                                                                                                                                                        |
| Time                  | `/time`                   | Clock controls and timesheet information. A schedule must be configured for calculated totals.                                                                                                                                                                                                                               |
| Corrections           | `/time/corrections`       | Time correction request interface.                                                                                                                                                                                                                                                                                           |
| Time export           | `/time/export`            | Request a time-record export for a date range; schedule configuration is required. See limitations below.                                                                                                                                                                                                                    |
| Shifts                | `/time/shifts`            | Roster and shift-swap interface. Some load failures are currently handled as empty lists.                                                                                                                                                                                                                                    |
| Kiosk                 | `/kiosk`                  | Shared-device clock interface with identifier and PIN.                                                                                                                                                                                                                                                                       |
| Documents             | `/documents`              | Document list, upload, acknowledgement, templates and bulk payslip actions where permitted.                                                                                                                                                                                                                                  |
| Onboarding            | `/onboarding`             | Checklist instances and task completion; also exposes CSV employee import.                                                                                                                                                                                                                                                   |
| Reports               | `/reports`                | Unavailable state: report summary and gestoria export currently return HTTP 503.                                                                                                                                                                                                                                             |
| Settings              | `/settings`               | Links to available configuration pages.                                                                                                                                                                                                                                                                                      |
| Departments           | `/settings/departments`   | Add departments and configure a minimum team-presence percentage.                                                                                                                                                                                                                                                            |
| Locations             | `/settings/locations`     | Create legal entities and locations; holiday configuration actions.                                                                                                                                                                                                                                                          |
| Custom fields         | `/settings/custom-fields` | Manage custom employee-field definitions.                                                                                                                                                                                                                                                                                    |
| Schedules             | `/settings/time`          | Assign an explicitly configured schedule to an employee. Existing open-ended assignments cannot yet be edited or closed here.                                                                                                                                                                                                |
| Security              | `/settings/security`      | Organization security settings and two-factor controls.                                                                                                                                                                                                                                                                      |
| SSO                   | `/settings/sso`           | SSO configuration interface.                                                                                                                                                                                                                                                                                                 |
| API tokens            | `/settings/tokens`        | API-token management interface.                                                                                                                                                                                                                                                                                              |
| Webhooks              | `/settings/webhooks`      | Webhook management and delivery-test interface.                                                                                                                                                                                                                                                                              |

Root (`/`) and localized root (`/[locale]`) routes provide entry or redirect
behavior rather than additional product screens. Notifications are available
through the application shell rather than a dedicated notification-center route.

## API and domain capabilities

The API exposes additional building blocks that are not necessarily complete
end-to-end web workflows. See `apps/api/src/routes/` and the generated OpenAPI
document for request and response details.

| Area                             | Existing API / domain surface                                                                                                                                | Important qualification                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and organization        | Sign-in/out, TOTP setup and verification, invitations, SSO configuration, setup, organization, legal entities, locations, departments and custom fields.     | The full account, session, password-reset and organization administration screens specified in the PRD are not all present.                                                                                             |
| People                           | Employee list/create/update, profile, termination, sensitive-field reveal, reporting hierarchy, emergency contacts, self-service, PIN and CSV import.        | Profile screens do not expose all employment-history and offboarding workflows in the target inventory.                                                                                                                 |
| Leave                            | Leave types, balances, requests, decisions, cancellations, adjustments, blackouts, delegations, holidays, team absences and ICS feed.                        | A configured department coverage percentage is required for relevant requests; half-day coverage can be unverifiable. Policy editing, a dedicated approvals inbox and balance explainer remain incomplete.              |
| Working time                     | Clock events, current status, timesheets, time exports, corrections, schedules, kiosk clocking, time bank and shift/roster endpoints.                        | Day grouping currently uses UTC and does not correctly handle all local-day or overnight boundaries. Schedule rules must be explicitly configured. Do not treat the export as a verified inspection or compliance pack. |
| Documents and checklists         | Document upload/download/deletion, acknowledgements, bulk payslip processing, document templates, checklist templates, checklist instances and task updates. | The complete company-document, versioning, template-management, new-hire and offboarding screen inventory is not present.                                                                                               |
| Notifications and administration | Notification read state, audit retrieval, data-subject export, tokens, webhooks and organization security endpoints.                                         | These endpoints do not imply a complete notification center, audit console, data-request lifecycle, retention manager or delivery log UI.                                                                               |
| Reports                          | Report-summary and gestoria-export routes exist.                                                                                                             | Both are deliberately unavailable (HTTP 503), pending correct data sources, date calculations and scoped access. No payroll is calculated.                                                                              |

## Not yet represented by dedicated screens

The supplied screen inventory includes further work beyond the routes above,
including password reset and account/session management; a complete profile and
job-history workflow; approval inbox and balance ledger; leave policy and holiday
calendar administration; team-time and scoped auditor views; company documents;
checklist template and pre-account new-hire flows; reporting and month close;
privacy, retention, data-request and audit administration; global search; and
platform administration. Backend pieces may exist for some of these; they should
not be treated as finished workflows without checking their implementation and
tests.

## Verification and product limits

- Automated checks do not establish that all screens, permissions and failure
  states are complete. Consult the redesign plan for remaining release gates.
- The employee profile currently substitutes sample profile or emergency-contact
  data after certain API failures. This is a known unresolved data-integrity
  issue, not a supported demo mode.
- Time and leave policy values require real organization configuration. No
  assumed eight-hour workday or default department coverage is used for these
  calculations.
- Report results and gestoria export are unavailable rather than populated with
  placeholder figures. The time export has the date-boundary limitation above.
- Research supplied for the redesign is secondary research, not completed
  primary usability validation. Legal status and compliance claims require
  independent review.
