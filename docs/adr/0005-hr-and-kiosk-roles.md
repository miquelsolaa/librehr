# ADR 0005: HR Admin and Kiosk Device Roles

## Status

Proposed (needs human review; nothing in this ADR is implemented yet)

## Date

2026-11-21

## Context

ADM-001 asks for the roles Owner, HR Admin, Payroll, Manager, Employee and
Auditor, plus custom roles built from permissions. The built-in roles in
`packages/contracts/src/permissions.ts` (`ROLE_PERMISSIONS`) are `admin`,
`manager`, `employee` and `auditor`. Owner and HR Admin are both `admin`
today.

Two problems follow from that.

1. **Self-approval in small organizations (#36).** Nobody may decide their
   own leave request (LEA-004), so an organization whose only approver is one
   admin cannot get that admin's leave decided. PR #36 adds a narrow
   exception: when nobody else could decide the request (no other live member
   holds `leave.request.approve` over that employee, and no active LEA-008
   delegate exists), the requester may approve their own leave with a
   reason, audited as `leave.request.self_approve` (ADM-002). A separate HR
   Admin role would let an owner hand approvals to someone else instead of
   relying on that exception.
2. **Kiosk devices (TIM-010).** The kiosk route needs a session holding
   `time.kiosk`, and only `admin` has that permission. A shared device
   therefore signs in as an administrator, with access to everything an
   admin can do if the device is left unattended or its session is stolen.

The code also checks role strings that no built-in role has. These checks are
dead branches today, or they grant nothing, and they disagree with each other
about the name of the HR role:

| Location                                      | Check                                     | Effect today                                                                                                       |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/routes/custom-fields.ts:49`     | `role !== "admin" && role !== "hr"`       | Only `admin` can create custom fields                                                                              |
| `apps/api/src/routes/custom-fields.ts:99`     | `role !== "admin" && role !== "hr"`       | Only `admin` can update custom fields                                                                              |
| `apps/api/src/routes/employees.ts:733`        | `role === "admin" \|\| role === "hr"`     | Only `admin` (or the employee) sets a kiosk PIN                                                                    |
| `apps/api/src/routes/sso-stored-config.ts:45` | `role !== "admin" && role !== "hr_admin"` | Only `admin` manages stored SSO configuration                                                                      |
| `apps/api/src/routes/documents.ts:642`        | `role !== "admin" && role !== "hr_admin"` | Only `admin` creates document templates                                                                            |
| `apps/api/src/routes/documents.ts:881`        | `role !== "admin" && role !== "hr_admin"` | Only `admin` deletes document templates                                                                            |
| `ee/core/src/sso/routes.ts:58`                | `role !== "admin" && role !== "hr_admin"` | Only `admin` manages SSO (Business edition)                                                                        |
| `apps/api/src/policies/custom-fields.ts:19`   | `role === "admin" ? "admin" : "hr"`       | Maps any organization-scoped employee reader to the `"hr"` visibility tier. This is a visibility tier, not a role. |
| `packages/db/src/schema/identity.ts:79`       | comment lists `hr_admin`                  | Documentation only                                                                                                 |

The `"hr"` value in `custom_fields.visibility` (contracts, repository and web
settings page) is a field visibility level, not a role. It stays as it is.

## Proposal

### 1. Add an `hr_admin` role

`hr_admin` runs people operations. It cannot change organization settings,
security settings or billing. Those stay with `admin`, which acts as the
Owner.

| Permission                | `admin` (Owner) | `hr_admin` (proposed) |
| ------------------------- | --------------- | --------------------- |
| `org.read`                | organization    | organization          |
| `org.write`               | organization    | none                  |
| `employee.read`           | organization    | organization          |
| `employee.write`          | organization    | organization          |
| `employee.read_sensitive` | organization    | organization          |
| `leave.request.create`    | organization    | organization          |
| `leave.request.read`      | organization    | organization          |
| `leave.request.approve`   | organization    | organization          |
| `time.clock`              | self            | self                  |
| `time.record.read`        | organization    | organization          |
| `time.record.correct`     | organization    | organization          |
| `time.kiosk`              | organization    | none                  |
| `document.read`           | organization    | organization          |
| `document.write`          | organization    | organization          |
| `audit.read`              | organization    | organization          |

Managing SSO, security settings, invitations of admins and Business licences
stays with `admin`. Whether `hr_admin` may manage custom fields and kiosk PINs
is an open question below.

Because `hr_admin` holds `leave.request.approve` at organization scope, an
organization with an owner and an HR admin has two possible approvers, and
the self-approval exception from #36 no longer applies to either of them.

### 2. Add a `kiosk` device role (TIM-010)

A kiosk membership belongs to a device account, not to a person. It has no
linked employee and is invited by an admin with a mandatory
`access_expires_at`, like auditors (TIM-008), so it can be revoked or allowed
to lapse.

| Permission      | `kiosk` (proposed) |
| --------------- | ------------------ |
| `time.kiosk`    | organization       |
| every other one | none               |

With `kiosk`, `admin` can lose `time.kiosk` and shared devices no longer need
an admin session. The kiosk route already rate-limits and locks out failed
PINs. That does not change.

### 3. Replace role-string checks with permissions

Every check in the inventory above becomes a `can(ctx, permission)` call:

- Custom-field definitions: `org.write` (or a new `org.custom_fields.write`
  if `hr_admin` should manage them).
- Kiosk PIN: `employee.write` on that employee, or self.
- SSO and stored SSO configuration: `org.write`.
- Document templates (create, delete): `document.write`.

No route should compare `user.role` with a literal string after this change.
A lint rule could enforce that.

## Consequences

- Owners can hand approvals to an HR admin, so fewer organizations need the
  self-approval exception.
- Kiosk devices stop holding admin sessions. That reduces the impact of a
  stolen or unattended device.
- The `memberships.role` column and the invitation flow need to accept the
  new role names. That is additive: existing rows keep their roles.
- The web role pickers, i18n catalogs (ca, es, en) and `docs/functionality.md`
  need updating.
- Custom roles (ADM-001) are still out of scope. This ADR adds two fixed
  roles only.

## Open questions

1. Should `hr_admin` manage custom-field definitions and set kiosk PINs?
2. Should `hr_admin` read the audit log, or only `admin` and `auditor`?
3. Should a kiosk device be bound to a location, so it can only clock
   employees of that site (location scope)?
4. Is a Payroll role (ADM-001) needed before payslip access is opened up
   further? It is not proposed here.
