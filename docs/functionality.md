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

| Screen                | Route after locale        | Functionality present / qualification                                                                                                                                                                                                                     |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in               | `/sign-in`                | Email and password sign-in.                                                                                                                                                                                                                               |
| First-run setup       | `/setup`                  | Organization setup form; not the complete seven-step target wizard.                                                                                                                                                                                       |
| Invitation            | `/invite/[token]`         | View and accept an invitation.                                                                                                                                                                                                                            |
| Home                  | `/home`                   | Clock and overview cards, using account data when available.                                                                                                                                                                                              |
| People                | `/people`                 | Employee directory and invitation flow.                                                                                                                                                                                                                   |
| Employee              | `/people/[id]`            | Profile and selected actions including self-service, emergency contacts, custom fields, termination, sensitive-field reveal and kiosk PIN. Profile and emergency-contact load failures are shown explicitly. Does not implement every target profile tab. |
| Organization chart    | `/people/org-chart`       | Reporting hierarchy.                                                                                                                                                                                                                                      |
| Time off              | `/time-off`               | Balances, ledger history and requests, with cancellation where permitted.                                                                                                                                                                                 |
| Request time off      | `/time-off/request`       | Leave request form; coverage and schedule configuration can block submission.                                                                                                                                                                             |
| Team absence calendar | `/time-off/calendar`      | Calendar view with scope-aware leave type visibility.                                                                                                                                                                                                     |
| Time                  | `/time`                   | Clock controls and timesheet information. A schedule must be configured for calculated totals.                                                                                                                                                            |
| Corrections           | `/time/corrections`       | Time correction request interface.                                                                                                                                                                                                                        |
| Time export           | `/time/export`            | Request a time-record export for a date range; schedule configuration is required. See limitations below.                                                                                                                                                 |
| Shifts                | `/time/shifts`            | Roster and shift-swap interface. Loading failures are reported with a retry action; roster generation and swap failures are shown to the user.                                                                                                            |
| Kiosk                 | `/kiosk`                  | Shared-device clock interface with identifier and PIN.                                                                                                                                                                                                    |
| Documents             | `/documents`              | Document list, upload, acknowledgement, templates and bulk payslip actions where permitted.                                                                                                                                                               |
| Onboarding            | `/onboarding`             | Checklist instances and task completion; also exposes CSV employee import.                                                                                                                                                                                |
| Reports               | `/reports`                | Administrators can request headcount metrics for a date range when employment history is complete and unambiguous. Absence, overtime and gestoría reports remain unavailable.                                                                             |
| Settings              | `/settings`               | Links to available configuration pages.                                                                                                                                                                                                                   |
| Departments           | `/settings/departments`   | Add departments and configure a minimum team-presence percentage.                                                                                                                                                                                         |
| Locations             | `/settings/locations`     | Create legal entities and locations; holiday configuration actions.                                                                                                                                                                                       |
| Custom fields         | `/settings/custom-fields` | Manage custom employee-field definitions.                                                                                                                                                                                                                 |
| Schedules             | `/settings/time`          | Assign an explicitly configured schedule to an employee. Existing open-ended assignments cannot yet be edited or closed here.                                                                                                                             |
| Security              | `/settings/security`      | Organization security settings and two-factor controls.                                                                                                                                                                                                   |
| SSO                   | `/settings/sso`           | SSO configuration interface.                                                                                                                                                                                                                              |
| API tokens            | `/settings/tokens`        | API-token management interface.                                                                                                                                                                                                                           |
| Webhooks              | `/settings/webhooks`      | Webhook management and delivery-test interface.                                                                                                                                                                                                           |

Root (`/`) and localized root (`/[locale]`) routes provide entry or redirect
behavior rather than additional product screens. Notifications are available
through the application shell rather than a dedicated notification-center route.

## API and domain capabilities

The API exposes additional building blocks that are not necessarily complete
end-to-end web workflows. See `apps/api/src/routes/` and the generated OpenAPI
document for request and response details.

| Area                             | Existing API / domain surface                                                                                                                                | Important qualification                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and organization        | Sign-in/out, TOTP setup and verification, invitations, SSO configuration, setup, organization, legal entities, locations, departments and custom fields.     | The full account, session, password-reset and organization administration screens specified in the PRD are not all present.                                                                                                                                                      |
| People                           | Employee list/create/update, profile, termination, sensitive-field reveal, reporting hierarchy, emergency contacts, self-service, PIN and CSV import.        | Profile screens do not expose all employment-history and offboarding workflows in the target inventory.                                                                                                                                                                          |
| Leave                            | Leave types, balances, requests, decisions, cancellations, adjustments, blackouts, delegations, holidays, team absences and ICS feed.                        | A configured department coverage percentage is required for relevant requests; half-day coverage can be unverifiable. Policy editing and a dedicated approvals inbox remain incomplete.                                                                                          |
| Working time                     | Clock events, current status, timesheets, time exports, corrections, schedules, kiosk clocking, time bank and shift/roster endpoints.                        | Timesheets and exports apply referenced corrections and split closed sessions at organization-local midnight. Invalid correction references fail calculation; schedule rules must be explicitly configured. Do not treat the export as a verified inspection or compliance pack. |
| Documents and checklists         | Document upload/download/deletion, acknowledgements, bulk payslip processing, document templates, checklist templates, checklist instances and task updates. | The complete company-document, versioning, template-management, new-hire and offboarding screen inventory is not present.                                                                                                                                                        |
| Notifications and administration | Notification read state, audit retrieval, data-subject export, tokens, webhooks and organization security endpoints.                                         | These endpoints do not imply a complete notification center, audit console, data-request lifecycle, retention manager or delivery log UI.                                                                                                                                        |
| Reports                          | An administrator-session-only headcount endpoint and unavailable summary and gestoría-export routes exist.                                                   | Headcount fails closed for incomplete or multiple employment periods. Summary and gestoría export return HTTP 503 pending reliable inputs. No payroll is calculated.                                                                                                             |

## Not yet represented by dedicated screens

The supplied screen inventory includes further work beyond the routes above,
including password reset and account/session management; a complete profile and
job-history workflow; approval inbox; leave policy and holiday
calendar administration; team-time and scoped auditor views; company documents;
checklist template and pre-account new-hire flows; reporting and month close;
privacy, retention, data-request and audit administration; global search; and
platform administration. Backend pieces may exist for some of these; they should
not be treated as finished workflows without checking their implementation and
tests.

## Verification and product limits

- Automated checks do not establish that all screens, permissions and failure
  states are complete. Consult the redesign plan for remaining release gates.
- Time and leave policy values require real organization configuration. No
  assumed eight-hour workday or default department coverage is used for these
  calculations.
- Absence and overtime reports and gestoría export are unavailable rather than
  populated with placeholder figures.
- Research supplied for the redesign is secondary research, not completed
  primary usability validation. Legal status and compliance claims require
  independent review.
- Approvals (LEA-004, TIM-003, TIM-005): nobody approves or rejects their own
  leave request, time correction or shift swap (as requester or as target),
  administrators included; the API answers 403
  with code `SELF_APPROVAL_FORBIDDEN`. Built-in roles do not separate Owner
  and HR Admin (both are `admin`), so an organization whose only approver is a
  single admin without a manager cannot get that admin's requests decided.
  Add a second admin, or set a manager for that admin; there is no override.
- Payslips (DOC-003): opened by the employee and by administrators (standing
  in for Owner/HR Admin until a Payroll role exists, ADM-001); not by managers
  or auditors. Every download is audited with ids only (ADM-002).
- Document deletion (DOC-001) is soft: the document disappears from lists,
  downloads and acknowledgements, while its rows and stored files are kept
  until retention enforcement (ADM-005, not yet implemented) purges them.
