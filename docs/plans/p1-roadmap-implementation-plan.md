# LibreHR v1.1 Implementation Plan: PRD P1 Requirements by Phases

This plan outlines the systematic implementation of all remaining **P1 (Should-Have)** and strategic requirements from `PRD.md`, organized into deliverable phases. Each phase follows LibreHR's clean-room standards, architecture boundaries (`core` -> `db` -> `contracts` -> `api` -> `worker` -> `web`), multi-tenant RLS, trilingual i18n (`ca`, `es`, `en`), and `pnpm verify` validation.

---

## Phase Overview

| Phase       | Focus Area                                         | PRD Target Requirements                    | Primary Deliverables                                                                                                              | Status          |
| ----------- | -------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Phase 1** | **Org Structure & Employee Self-Service**          | `ORG-004`, `ORG-005`, `EMP-002`, `EMP-005` | Visual interactive Org Chart, Custom Fields system (definitions & values), Emergency Contacts, and Employee Profile Self-Service. | **Completed**   |
| **Phase 2** | **In-App Notifications & Document Acknowledgment** | `NOT-002`, `DOC-006`                       | In-app notification center (topbar bell, unread count, badge, notification drawer/feed), Policy read receipts & timestamps.       | **Completed**   |
| **Phase 3** | **Advanced Working Time & Kiosk Mode**             | `TIM-010`, `TIM-008`, `TIM-012`            | Tablet Kiosk Mode with quick PIN/QR clock-in (`/kiosk`), Read-only Labour Inspector role, Time bank / compensatory overtime rest. | **In Progress** |
| **Phase 4** | **Advanced Leave & Team Coverage**                 | `LEA-007`, `LEA-008`                       | Team coverage threshold warnings/blocks, Manager absence delegate approval chains.                                                | Planned         |
| **Phase 5** | **Enterprise Auth & Security Hardening**           | `AUTH-003`, `AUTH-004`, `DOC-007`          | Organization-level enforced 2FA TOTP, OIDC Enterprise SSO (Google/Microsoft), Document templates with merge fields.               | Planned         |

---

## Detailed Specification: Phase 2 (In-App Notifications & Document Acknowledgment) - COMPLETED

### 1. Requirements in Scope

- **`NOT-002` (P1): In-App Notification Center**
  - Notification bell in header showing live unread count badge.
  - Dropdown drawer listing recent notification items (leave status changes, policy updates, assigned tasks).
  - Ability to click an individual notification to mark as read and navigate.
  - "Mark all as read" batch endpoint `POST /v1/notifications/read-all`.
- **`DOC-006` (P1): Policy Acknowledgment & Read Receipts**
  - Track read-receipt timestamps for company policies and mandatory handbooks.
  - Endpoint `POST /v1/documents/:id/acknowledge` for employees to acknowledge policies.
  - Endpoint `GET /v1/documents/:id/acknowledgements` for HR/admins to audit receipt compliance.
  - UI action on document cards to sign/acknowledge with acknowledged badge and status indicator.

---

## Detailed Specification: Phase 3 (Advanced Working Time & Kiosk Mode) - IN PROGRESS

### 1. Requirements in Scope

- **`TIM-010` (P1): Tablet Kiosk Clock-in Mode**
  - Dedicated shared tablet kiosk interface at `/kiosk` with PIN keypad.
  - Fast clock in / clock out without requiring personal smartphone or full web session.
  - Kiosk session authenticated by an authorized organization device token.
  - PIN verification and event recording directly to append-only `time_events`.
- **`TIM-008` (P1): Labour Inspector (Inspección de Trabajo) Role**
  - Dedicated read-only role `auditor` / `inspector` with scoped access exclusively to working time records (`time_events`, `daily_summaries`, timesheets) and mandatory 4-year retention logs.
  - Disallows viewing unrelated personal employee records (medical leave reasons, salaries, banking info).
  - One-click official export generation for compliance audits.
- **`TIM-012` (P1): Time Bank & Compensatory Overtime Rest**
  - Calculation and tracking of overtime hours accumulated in an employee's time bank.
  - Option to designate overtime as compensatory paid rest instead of monetary payout.
  - Ledger balance tracking compensatory rest availability and consumption.

---

## Detailed Specification: Phase 1 (Org Structure & Employee Self-Service)

### 1. Requirements in Scope

- **`ORG-004` (P1): Visual Organization Chart**
  - Searchable, collapsible tree view visualising manager-to-report hierarchies across departments.
  - Clean card rendering: avatar, name, title, department, team count, direct reports count.
  - Interactive navigation: click on any manager to expand/collapse or refocus sub-tree.
  - Export/print view option.
- **`ORG-005` (P1): Custom Profile Fields**
  - Resolves stubs in `packages/db/src/schema/people.ts` for custom field definitions and values.
  - Definition attributes: name, code, type (`text`, `number`, `date`, `select`), options list, required flag, visibility scope (`admin`, `hr`, `manager`, `employee`, `public`).
  - Management UI under Settings (`/settings/custom-fields`).
  - Dynamic profile rendering and editing respecting field visibility scopes.
- **`EMP-002` & `EMP-005` (P1): Emergency Contacts & Profile Self-Service**
  - Resolves stub in `packages/db/src/schema/people.ts` for `emergency_contacts`.
  - Multiple emergency contacts per employee: full name, relationship (spouse, parent, sibling, other), priority order, primary phone, secondary phone.
  - Self-service mode allowing employees to view and update their own personal contact details, address, and emergency contacts directly from `/people/[id]`.
  - Changes logged to the immutable `audit_log`.

### 2. Implementation Steps for Phase 1

1. **Database Layer (`packages/db`):**
   - Implement `customFieldDefinitions`, `customFieldValues`, and `emergencyContacts` pgTables in `packages/db/src/schema/people.ts`.
   - Register tables in `TENANT_TABLES` for PostgreSQL RLS isolation.
   - Generate and apply migration `0007_custom_fields_emergency_contacts.sql`.
   - Repositories for custom fields and emergency contacts.
2. **Contracts & API Layer (`packages/contracts`, `apps/api`):**
   - Zod schemas for custom fields, emergency contacts, and self-service updates.
   - Org chart hierarchy calculation endpoint `GET /v1/people/org-chart`.
   - CRUD endpoints for `/v1/custom-fields` and `/v1/people/:id/emergency-contacts`.
   - Self-service endpoint `PATCH /v1/people/:id/self-service`.
3. **Web Application & UI (`apps/web`, `packages/i18n`):**
   - Org Chart view at `/people/org-chart` and tab switch on `/people`.
   - Settings page for Custom Fields at `/settings/custom-fields`.
   - Emergency contacts widget and self-edit modal on Employee Profile page (`/people/[id]`).
   - Localization keys in `ca.json`, `es.json`, `en.json`.
4. **Testing & Verification:**
   - Unit and integration tests for hierarchy builder, custom field permissions, and self-service boundaries.
   - Run `pnpm verify` to certify 0 lint, type, and test errors.
