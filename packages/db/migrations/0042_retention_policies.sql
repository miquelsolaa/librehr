-- 0042_retention_policies.sql
-- ADM-005 (issue #32): retention policies by data category.
--
-- One optional row per organization and category overrides the default
-- period of packages/core/src/retention (RETENTION_CATEGORY_DEFINITIONS).
-- No rows are seeded: a missing row means "use the core default", so a
-- default can change later without a data migration. The defaults are
-- pending confirmation by counsel (COMPLIANCE.md section 5).
--
-- The retention job is report-only: it counts eligible records and deletes
-- nothing. This migration adds no purge flag, no file-deletion outbox and no
-- delete path; enabling purges is a separate, counsel-gated change.
--
-- Legal floors are CHECK constraints, so neither the API nor plain SQL can
-- store a period below them: time records are kept at least 4 years (1461
-- days, Estatuto de los Trabajadores art. 34.9). The category list mirrors
-- RETENTION_CATEGORIES in packages/core.
--
-- No SECURITY DEFINER function: the instance-wide password_reset_tokens
-- sweep is a time-based DELETE on a global table whose runtime and owner
-- roles already hold DELETE (0040). It looks nothing up by user id, so the
-- 0019/0021 rule against cross-tenant user lookups is not touched.
--
-- New table only (additive), safe on a populated database.
-- Rollback: DROP TABLE retention_policies; no existing data changes.

CREATE TABLE IF NOT EXISTS "retention_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "retention_days" integer NOT NULL,
  "updated_by" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "retention_policies_org_category_unique"
    UNIQUE ("organization_id", "category"),
  CONSTRAINT "retention_policies_category_check"
    CHECK ("category" IN (
      'time_records',
      'leave_records',
      'audit_log',
      'deleted_documents',
      'statutory_documents',
      'notifications',
      'invitations'
    )),
  CONSTRAINT "retention_policies_days_check"
    CHECK ("retention_days" BETWEEN 1 AND 36525),
  CONSTRAINT "retention_policies_time_records_floor"
    CHECK ("category" <> 'time_records' OR "retention_days" >= 1461)
);

ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "retention_policies_tenant_isolation" ON "retention_policies";
CREATE POLICY "retention_policies_tenant_isolation" ON "retention_policies"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Admins set and reset (delete) periods; explicit, in case the default
-- privileges of 0015 belong to another role than the one running this.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON "retention_policies" TO %I',
        runtime_role
      );
      EXECUTE format(
        'REVOKE TRUNCATE ON "retention_policies" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE "retention_policies" IS
  'ADM-005: per-organization retention period overrides by data category; a missing row means the core default.';
