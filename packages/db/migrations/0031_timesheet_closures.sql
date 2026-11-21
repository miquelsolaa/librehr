-- 0031_timesheet_closures.sql
-- TIM-004 (#31): monthly timesheet closure.
--
-- An admin closes an employee's month: the API stores a snapshot of the
-- month's timesheet summary as it was at that instant. Reopening appends a
-- 'reopen' row with a mandatory reason. Nothing is ever updated or deleted,
-- so the current state of a month is its newest row (close or reopen).
--
-- Closing never blocks corrections: time events appended to a closed month
-- after the close are flagged by the API (TIM-004), not rejected.
--
-- New table only (additive), safe on a populated database.
-- Rollback note: forward-only. Dropping the table loses the closure history,
-- which is an audit record; do so only on a database that never used it.

CREATE TABLE IF NOT EXISTS "timesheet_closures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  -- Local calendar days (the employee's business time zone), not instants.
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "action" text NOT NULL,
  -- PeriodTimesheetSummary at closing time; NULL for a reopen.
  "totals" jsonb NULL,
  "reason" text NULL,
  "actor_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "timesheet_closures_action_check"
    CHECK ("action" IN ('close', 'reopen')),
  CONSTRAINT "timesheet_closures_period_check"
    CHECK ("period_end" >= "period_start"),
  CONSTRAINT "timesheet_closures_payload_check"
    CHECK (
      ("action" = 'close' AND "totals" IS NOT NULL)
      OR ("action" = 'reopen' AND "totals" IS NULL
          AND "reason" IS NOT NULL AND length(btrim("reason")) > 0)
    )
);

-- Latest row per employee and period, and the month listing.
CREATE INDEX IF NOT EXISTS "timesheet_closures_employee_period_idx"
  ON "timesheet_closures" ("organization_id", "employee_id", "period_start", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "timesheet_closures_org_period_idx"
  ON "timesheet_closures" ("organization_id", "period_start");

ALTER TABLE "timesheet_closures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timesheet_closures" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "timesheet_closures_tenant_isolation" ON "timesheet_closures";
CREATE POLICY "timesheet_closures_tenant_isolation" ON "timesheet_closures"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Append-only, as time_events and audit_log (0001).
DROP TRIGGER IF EXISTS "prevent_mod_timesheet_closures" ON "timesheet_closures";
CREATE TRIGGER "prevent_mod_timesheet_closures"
  BEFORE UPDATE OR DELETE ON "timesheet_closures"
  FOR EACH ROW EXECUTE FUNCTION openhr_prevent_modification();

-- Default privileges (0015) grant UPDATE/DELETE on new tables; the runtime
-- roles keep SELECT and INSERT only.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT ON "timesheet_closures" TO %I',
        runtime_role
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON "timesheet_closures" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE "timesheet_closures" IS
  'TIM-004: append-only monthly timesheet close/reopen log; the newest row per employee and period is the current state.';
