# LibreHR v1.1 Implementation Plan: PRD P1 Requirements by Phases

This plan outlines the systematic implementation of all remaining **P1 (Should-Have)** and strategic requirements from `PRD.md`, organized into deliverable phases. Each phase follows LibreHR's clean-room standards, architecture boundaries (`core` -> `db` -> `contracts` -> `api` -> `worker` -> `web`), multi-tenant RLS, trilingual i18n (`ca`, `es`, `en`), and `pnpm verify` validation.

---

## Phase Overview

| Phase       | Focus Area                                         | PRD Target Requirements                    | Primary Deliverables                                                                                                              | Status        |
| ----------- | -------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Phase 1** | **Org Structure & Employee Self-Service**          | `ORG-004`, `ORG-005`, `EMP-002`, `EMP-005` | Visual interactive Org Chart, Custom Fields system (definitions & values), Emergency Contacts, and Employee Profile Self-Service. | **Completed** |
| **Phase 2** | **In-App Notifications & Document Acknowledgment** | `NOT-002`, `DOC-006`                       | In-app notification center (topbar bell, unread count, badge, notification drawer/feed), Policy read receipts & timestamps.       | **Completed** |
| **Phase 3** | **Advanced Working Time & Kiosk Mode**             | `TIM-010`, `TIM-008`, `TIM-012`            | Tablet Kiosk Mode with quick PIN/QR clock-in (`/kiosk`), Read-only Labour Inspector role, Time bank / compensatory overtime rest. | **Completed** |
| **Phase 4** | **Advanced Leave & Team Coverage**                 | `LEA-007`, `LEA-008`                       | Team coverage threshold warnings/blocks, Manager absence delegate approval chains.                                                | **Completed** |
| **Phase 5** | **Enterprise Auth & Security Hardening**           | `AUTH-003`, `AUTH-004`, `DOC-007`          | Organization-level enforced 2FA TOTP, OIDC Enterprise SSO (Google/Microsoft), Document templates with merge fields.               | **Completed** |

---

## Detailed Specification: Phase 5 (Enterprise Auth & Security Hardening) - COMPLETED

### 1. Requirements in Scope

- **`AUTH-003` (P1): Enforced 2FA / TOTP Authentication & Recovery Codes**
  - RFC 6238 TOTP computation with dynamic truncation and 30-second window.
  - Setup flow with standard `otpauth://` URI generation and 8 single-use cryptographically hashed recovery codes.
  - Two-step sign-in challenge flow: when 2FA is active, sign-in issues a short-lived HMAC-signed challenge token, followed by 6-digit or recovery code validation.
  - Organization-level policy toggle allowing administrators to require 2FA for all members.
- **`AUTH-004` (P1): Enterprise OIDC Single Sign-On (SSO)**
  - Support for Google Workspace, Microsoft Entra ID (Azure AD), and generic OpenID Connect identity providers.
  - Configurable client ID, client secret (encrypted), discovery/issuer URL, and allowed email domains.
  - Mandatory SSO enforcement toggle and automatic domain discovery on the sign-in screen.
- **`DOC-007` (P1): Document Templates & Merge Field Engine**
  - Pure domain template engine supporting merge variables (`{{employee.name}}`, `{{employee.dni}}`, `{{employee.job_title}}`, `{{employee.department}}`, `{{employee.hire_date}}`, `{{organization.name}}`, `{{current_date}}`).
  - Document templates repository and API endpoints (`GET /v1/documents/templates`, `POST /v1/documents/templates`, `POST /v1/documents/templates/:id/render`, `DELETE /v1/documents/templates/:id`).
  - Web UI for managing templates and generating merged letters or certificates with live preview and envelope encryption.

### 2. Implementation Deliverables

- **Core Domain:**
  - `packages/core/src/identity/totp.ts`: RFC 6238 TOTP generation, verification, and recovery code hashing.
  - `packages/core/src/identity/sso.ts`: OIDC authorization URL builder and domain validation.
  - `packages/core/src/documents/merge-templates.ts`: Pure variable extraction and template merge substitution engine.
  - Unit tests in `packages/core/test/totp.test.ts`, `sso.test.ts`, `merge-templates.test.ts`.
- **Database & RLS:**
  - Migration `0010_auth_hardening_and_templates.sql` adding `require_two_factor` to `organizations`, 2FA fields to `users`, and creating `sso_configurations` and `document_templates` tables with PostgreSQL RLS policies enabled.
  - Registered tables in `TENANT_TABLES` in `packages/db/src/rls/helpers.ts`.
  - Repositories: `SsoRepository`, `DocumentRepository` template methods, and `UserRepository` 2FA methods.
- **Contracts & API:**
  - Zod schemas in `packages/contracts/src/auth.ts` and `documents.ts`.
  - Regenerated OpenAPI specs and type-safe API client.
  - API routes: `createAuthRoutes` 2FA setup/enable/verify/disable endpoints, `createSsoRoutes`, `createSettingsSecurityRoutes`, and document template routes.
- **Web UI & i18n:**
  - `/sign-in`: Two-step 2FA verification prompt and SSO discovery.
  - `/settings/security`: User 2FA activation/disabling modal and organization-wide 2FA requirement policy toggle.
  - `/settings/sso`: Enterprise SSO identity provider configuration with redirect callback helper.
  - `/documents`: "Templates & Generation" tab with template creation modal and employee document generation modal with live preview.
  - Trilingual keys in `ca.json`, `es.json`, `en.json`.

---

## Detailed Specification: Phase 4 (Advanced Leave & Team Coverage) - COMPLETED

### 1. Requirements in Scope

- **`LEA-007` (P1): Team Coverage Rules & Blackout Periods**
  - Department or team-level minimum coverage thresholds (e.g. at least 60% of department must be present, or maximum N people absent on the same day).
  - Configurable blackout periods during peak business operations (e.g. tax filing deadline, Black Friday, quarter-end closure).
  - Warnings and blocks during leave request submission when team coverage falls below configured threshold or requested dates overlap with active blackouts.
- **`LEA-008` (P1): Manager Absence Delegation & Approval Chains**
  - Ability for managers going on leave to designate a delegate approver for their pending team requests.
  - Multi-step approval chain escalation when manager is unreachable.

### 2. Implementation Deliverables

- **Core Domain (`packages/core/src/leave/coverage.ts`):** Pure functions `checkBlackoutDate` and `evaluateTeamCoverage` enforcing department presence thresholds and blackout blocks without any I/O. Unit tests in `packages/core/test/coverage.test.ts`.
- **Database & RLS (`packages/db`):** Tables `blackoutPeriods` and `approvalDelegations` with RLS policies enabled in migration `0009_leave_coverage_delegations.sql`. Repository functions for blackout CRUD and delegation lookup (`getActiveDelegationsForDelegate`).
- **Contracts & API (`packages/contracts`, `apps/api`):** Zod schemas `BlackoutPeriodSchema`, `CreateBlackoutPeriodSchema`, `ApprovalDelegationSchema`, `CreateApprovalDelegationSchema`. API routes for `/v1/leave/blackouts` and `/v1/leave/delegations`. Leave submission validation and delegate approval decision rights.
- **Web UI & i18n (`apps/web`, `packages/i18n`):** Management cards on `/time-off`, inline blackout warning banner on `/time-off/request`, and full translation keys in `ca`, `es`, `en`.

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
