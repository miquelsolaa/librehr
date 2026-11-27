-- 0046_employee_memberships.sql
-- ORG-007 (issue #81, ADR 0008): employees in several departments, projects
-- and areas at once.
--
-- The primary department stays in employees.department_id. This migration
-- adds:
--
-- 1. UNIQUE (organization_id, id) on departments and employees. id is
--    already the primary key, so the indexes cannot fail on existing data.
--    They let the new tables use composite, same-tenant foreign keys
--    (ADR 0008 decision 5, as leave_ledger -> leave_types in 0033): foreign
--    key checks bypass RLS, so a plain FK would accept another tenant's id.
-- 2. org_groups: projects and areas (one table, kind = project | area).
--    Groups are archived (archived_at), never deleted by the API.
-- 3. employee_memberships: secondary links of an employee to exactly one
--    department or group, with validity dates (calendar dates in the
--    organization's time zone, never instants) and an optional allocation
--    percentage. Overlapping rows for the same employee and target are
--    rejected by exclusion constraints, like no_overlapping_employments
--    (0000; btree_gist is installed there). "Removing" a membership sets
--    end_date, ended_by and end_reason; rows are history. end_reason is a
--    coarse code, never free text, so no special-category reason (health,
--    union membership) can be recorded (COMPLIANCE.md, AGENTS.md section 5).
-- 4. invitations.department_id: the primary department an invited person
--    gets on accept (ADR 0008 decision 13). Nullable: auditors have none, and
--    deleting the department clears only this column.
--
-- On delete: memberships go with their employee (CASCADE). A department or
-- group that any membership references cannot be deleted (ADR decision 6).
-- That is NO ACTION rather than RESTRICT: both refuse a direct delete with
-- 23503, but NO ACTION is checked at the end of the statement, so deleting
-- a whole organization (which cascades to employees, memberships,
-- departments and groups in one statement) still works.
--
-- Both tables get RLS enabled and forced with the tenant policy, and are
-- listed in TENANT_TABLES (packages/db/src/rls/helpers.ts).
--
-- New tables and new indexes only (additive), safe on a populated database;
-- no backfill. Locks: CREATE UNIQUE INDEX takes a SHARE lock on departments
-- and employees (writes wait, reads continue) for the index build, which is
-- short at SMB sizes.
--
-- Rollback note: forward-only. ALTER TABLE invitations DROP COLUMN
-- department_id; DROP TABLE employee_memberships, org_groups;
-- DROP INDEX departments_org_id_uidx, employees_org_id_uidx; loses the
-- membership history, so do it only on a database that never used it, and
-- roll the code back first.

-- 1. Same-tenant keys on existing tables.
CREATE UNIQUE INDEX IF NOT EXISTS "departments_org_id_uidx"
  ON "departments" ("organization_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "employees_org_id_uidx"
  ON "employees" ("organization_id", "id");

-- 2. Projects and areas.
CREATE TABLE IF NOT EXISTS "org_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "description" text NULL,
  -- An area can hold projects (one level); the API checks the kinds.
  "parent_id" uuid NULL,
  "lead_employee_id" uuid NULL,
  -- Optional planned dates of a project (calendar dates).
  "starts_on" date NULL,
  "ends_on" date NULL,
  "archived_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "org_groups_kind_check" CHECK ("kind" IN ('project', 'area')),
  CONSTRAINT "org_groups_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "org_groups_dates_check"
    CHECK ("ends_on" IS NULL OR "starts_on" IS NULL OR "ends_on" >= "starts_on"),
  CONSTRAINT "org_groups_parent_not_self_check"
    CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_groups_org_id_uidx"
  ON "org_groups" ("organization_id", "id");
-- One active group per kind and name (case-insensitive); archived names can
-- be reused.
CREATE UNIQUE INDEX IF NOT EXISTS "org_groups_active_name_uidx"
  ON "org_groups" ("organization_id", "kind", lower("name"))
  WHERE "archived_at" IS NULL;
CREATE INDEX IF NOT EXISTS "org_groups_parent_idx"
  ON "org_groups" ("organization_id", "parent_id");
CREATE INDEX IF NOT EXISTS "org_groups_lead_idx"
  ON "org_groups" ("organization_id", "lead_employee_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint WHERE conname = 'org_groups_parent_fk'
  ) THEN
    ALTER TABLE "org_groups"
      ADD CONSTRAINT "org_groups_parent_fk"
      FOREIGN KEY ("organization_id", "parent_id")
      REFERENCES "org_groups" ("organization_id", "id");
  END IF;
  -- Only the lead column is cleared when the lead's employee row goes;
  -- organization_id is NOT NULL and must stay.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint WHERE conname = 'org_groups_lead_fk'
  ) THEN
    ALTER TABLE "org_groups"
      ADD CONSTRAINT "org_groups_lead_fk"
      FOREIGN KEY ("organization_id", "lead_employee_id")
      REFERENCES "employees" ("organization_id", "id")
      ON DELETE SET NULL ("lead_employee_id");
  END IF;
END $$;

ALTER TABLE "org_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_groups_tenant_isolation" ON "org_groups";
CREATE POLICY "org_groups_tenant_isolation" ON "org_groups"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

COMMENT ON TABLE "org_groups" IS
  'ORG-007: projects and areas an employee can belong to besides the primary department. Archived, never deleted.';

-- 3. Secondary memberships.
CREATE TABLE IF NOT EXISTS "employee_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL,
  "department_id" uuid NULL,
  "group_id" uuid NULL,
  -- Free label such as "member" or "lead"; never used for authorization.
  "role" text NULL,
  -- Optional share of the person's time; totals above 100 are a warning
  -- in the API, not a constraint.
  "allocation_percent" numeric(5, 2) NULL,
  -- Calendar dates in the organization's time zone; end_date included.
  "start_date" date NOT NULL,
  "end_date" date NULL,
  -- User ids of the actor who created and who ended the row.
  "created_by" uuid NOT NULL,
  "ended_by" uuid NULL,
  -- Coarse code only (see header); the API sets primary_changed itself.
  "end_reason" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "employee_memberships_one_target_check"
    CHECK (num_nonnulls("department_id", "group_id") = 1),
  CONSTRAINT "employee_memberships_allocation_check"
    CHECK ("allocation_percent" IS NULL
           OR ("allocation_percent" > 0 AND "allocation_percent" <= 100)),
  CONSTRAINT "employee_memberships_end_reason_check"
    CHECK ("end_reason" IS NULL OR "end_reason" IN
           ('project_ended', 'reassigned', 'primary_changed', 'other')),
  CONSTRAINT "employee_memberships_dates_check"
    CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT "employee_memberships_employee_fk"
    FOREIGN KEY ("organization_id", "employee_id")
    REFERENCES "employees" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "employee_memberships_department_fk"
    FOREIGN KEY ("organization_id", "department_id")
    REFERENCES "departments" ("organization_id", "id"),
  CONSTRAINT "employee_memberships_group_fk"
    FOREIGN KEY ("organization_id", "group_id")
    REFERENCES "org_groups" ("organization_id", "id"),
  CONSTRAINT "employee_memberships_no_overlap_department"
    EXCLUDE USING gist (
      employee_id WITH =,
      department_id WITH =,
      daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') WITH &&
    ) WHERE ("department_id" IS NOT NULL),
  CONSTRAINT "employee_memberships_no_overlap_group"
    EXCLUDE USING gist (
      employee_id WITH =,
      group_id WITH =,
      daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') WITH &&
    ) WHERE ("group_id" IS NOT NULL)
);

-- Referencing sides of the foreign keys and the directory/calendar EXISTS
-- filters (ADR 0008 consequences).
CREATE INDEX IF NOT EXISTS "employee_memberships_employee_idx"
  ON "employee_memberships" ("organization_id", "employee_id");
CREATE INDEX IF NOT EXISTS "employee_memberships_department_idx"
  ON "employee_memberships" ("organization_id", "department_id")
  WHERE "department_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "employee_memberships_group_idx"
  ON "employee_memberships" ("organization_id", "group_id")
  WHERE "group_id" IS NOT NULL;

ALTER TABLE "employee_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_memberships" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_memberships_tenant_isolation" ON "employee_memberships";
CREATE POLICY "employee_memberships_tenant_isolation" ON "employee_memberships"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

COMMENT ON TABLE "employee_memberships" IS
  'ORG-007: secondary links of an employee to one department or group with validity dates. The primary department stays in employees.department_id.';

-- 4. Primary department of an invited person (ADR 0008 decision 13).
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "department_id" uuid NULL;

DO $$
BEGIN
  -- Same-tenant key; only department_id is cleared when the department goes.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint WHERE conname = 'invitations_department_fk'
  ) THEN
    ALTER TABLE "invitations"
      ADD CONSTRAINT "invitations_department_fk"
      FOREIGN KEY ("organization_id", "department_id")
      REFERENCES "departments" ("organization_id", "id")
      ON DELETE SET NULL ("department_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invitations_department_idx"
  ON "invitations" ("organization_id", "department_id")
  WHERE "department_id" IS NOT NULL;

COMMENT ON COLUMN "invitations"."department_id" IS
  'ORG-007: primary department of the employee created when the invitation is accepted.';
