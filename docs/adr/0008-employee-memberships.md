# ADR 0008: Employee memberships in several departments, projects and areas

## Status

Accepted

## Date

2026-11-26

## Context

Issue #81 (`ORG-007`) asks that a person can belong to several departments,
projects and areas at once, each with validity dates, while exactly one
primary department stays required.

Today a person's only link to the org structure is `employees.department_id`:
one nullable column with `ON DELETE SET NULL`. About 40 call sites read it
(directory filter, team calendar, coverage and blackouts, document audience,
reports, policy context). There is no entity for projects or areas. The
`teams` table (migration 0007) has no members table, repository, route or UI.
Foreign key checks bypass RLS, so nothing in the database stops a row from
pointing at another tenant's id; only API lookups do.

The maintainer approved the recommended answer to every question below on
2026-11-26.

## Decision

1. **Primary stays in `employees.department_id`.** It remains the one source
   of truth for the contract, reporting line, default approvals and headcount,
   so "at most one primary" holds by construction and nothing is backfilled.
   Membership rows never hold the primary.
2. **Projects and areas are generalized groups (D1).** A new tenant table
   `org_groups` with `kind in ('project', 'area')`, name, optional
   description, parent (one level), lead, optional dates and `archived_at`.
   Departments stay in their own table because coverage, blackouts, document
   audience and the tree depend on them.
3. **Secondary links live in `employee_memberships`.** Each row links one
   employee to exactly one department or group (`num_nonnulls(...) = 1`),
   with an optional free-text role label (never used for authorization),
   `start_date`, optional `end_date`, and actor columns. Dates are calendar
   dates in the organization's time zone. Overlapping rows for the same
   employee and target are rejected by gist exclusion constraints, like
   `no_overlapping_employments`. The API never deletes a row: "remove" sets
   `end_date`, `ended_by` and `end_reason`. A secondary department equal to the
   current primary is rejected; changing the primary to a department held as
   a secondary ends that secondary the day before, in the same transaction.
4. **Allocation is an optional percentage (D3).** `allocation_percent` in
   (0, 100]. A total above 100% across a person's secondaries on a date is a
   warning, not a block. Hours are not stored; they derive from the
   employment's weekly hours.
5. **Tenant-safe foreign keys are declarative (D7).** Migration 0046 adds
   `UNIQUE (organization_id, id)` to `departments`, `employees` and
   `org_groups`, and the new tables reference them with composite
   `(organization_id, ...)` keys. Both new tables get RLS enabled and forced
   with the standard tenant policy and are added to `TENANT_TABLES`.
6. **Nothing is deleted from under history (D8).** Memberships cascade only
   with their employee. Departments and groups are restricted: deleting a
   department that any membership references answers 409. Groups are
   archived, never hard-deleted. Migration 0046 declares these keys as
   `NO ACTION` rather than `RESTRICT`. Both refuse a direct delete, but
   `NO ACTION` is checked at the end of the statement, so deleting a whole
   organization still cascades.
7. **The `department` permission scope stays primary-only (D4).** No built-in
   role uses it, and widening it could grant write rights to custom roles.
8. **Secondary-lead visibility is an organization setting (D2).** Values
   `off | calendar | profile`, default `calendar`. A lead is the
   `lead_employee_id` of a department or group, never a membership role
   label. `calendar` shows members' absences masked as "Away"; `profile`
   adds read-only directory fields. It never grants write, approval or
   sensitive-field access (EMP-004), and it is an allow-list of read
   permissions, not a change to the `reports` scope. The setting is an
   additive column added by migration 0047.
9. **Department documents reach secondary members (D5).** A document targeted
   at a department is visible to its primary members and to people with an
   active secondary membership in it.
10. **Coverage checks secondaries that have a policy (D6).** On each working
    day the primary is checked as today, plus every secondary department
    active that day that has a coverage policy; secondaries without one are
    skipped, so adding a membership never causes `COVERAGE_NOT_CONFIGURED`.
    Team size and absences count heads (allocation is ignored), and blocking
    behaves as for the primary. Blackouts are the union across every
    department active on the date.
11. **Directory and calendar filters match any membership.** A department
    filter matches the primary or a membership active on the organization's
    business date; a group filter is added. Headcount reports stay
    primary-based; a membership breakdown is labelled as overlapping.
12. **The `teams` table stays as is (D9).** Folding it into `org_groups` with
    `kind = 'team'` is tracked in issue #201.
13. **A primary department is required by the API (D10, option 2).** Creating
    or updating an employee without a department is a validation error from
    now on; existing employees without one are tolerated until edited. Setup,
    invitations and CSV import change to supply one (setup already assigns
    the management department; invitations and import do not yet). The column
    stays nullable, and deleting a department that is someone's primary
    answers 409 instead of clearing it.
14. **Community edition (D-edition).** Memberships extend the core org model
    that calendars and coverage use; `docs/editions.md` keeps only legal
    multi-entity groups for Business.
15. **New PRD item `ORG-007` (P1) (D-PRD)** carries the issue's acceptance
    criteria.

Membership and group changes are audited (`employee.membership.add|update|end`,
`org_group.create|update|archive`) with ids only, in the same transaction as
the write. Data subject access exports include memberships.

## Consequences

- Two places hold department links: the primary column and secondary rows.
  The API keeps them disjoint, and every consumer must state which basis it
  uses.
- Authorization widens in two read-only ways (lead visibility, document
  audience). Both have negative tests for write and approval.
- Adding the composite unique indexes briefly locks `employees` and
  `departments` while the migration runs; at SMB sizes this is short.
- `employees.department_id` keeps `ON DELETE SET NULL` in the database; the
  API's 409 guards the delete. A later, non-additive change could make the
  column `NOT NULL` once no nulls remain.
- Directory and calendar queries add `EXISTS` subqueries on memberships, backed
  by indexes on `(organization_id, department_id)`,
  `(organization_id, group_id)` and `employee_id`.

## Delivery

The work ships as a stack of pull requests, each under about 500 lines: this
record; database and core (migration 0046); API and contracts; directory and
calendar filters; management UI; coverage and blackouts; authorization and
the visibility setting (migration 0047); reports, org chart and data subject
access export. The required primary department (decision 13) is delivered in
the same stack, and the pull request that adds it says so.
