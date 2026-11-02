-- Migration 0009_leave_coverage_delegations.sql
-- Blackout Periods & Team Coverage (LEA-007), Manager Absence Approval Delegations (LEA-008)

-- 1. Create blackout_periods table
CREATE TABLE IF NOT EXISTS "blackout_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "department_id" uuid,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "blackout_periods_org_idx" ON "blackout_periods"("organization_id");
CREATE INDEX IF NOT EXISTS "blackout_periods_dates_idx" ON "blackout_periods"("organization_id", "start_date", "end_date");

ALTER TABLE "blackout_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blackout_periods" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "blackout_periods";
CREATE POLICY "tenant_isolation_policy" ON "blackout_periods"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 2. Create approval_delegations table
CREATE TABLE IF NOT EXISTS "approval_delegations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "manager_employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "delegate_employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "approval_delegations_org_idx" ON "approval_delegations"("organization_id");
CREATE INDEX IF NOT EXISTS "approval_delegations_mgr_idx" ON "approval_delegations"("organization_id", "manager_employee_id");
CREATE INDEX IF NOT EXISTS "approval_delegations_delegate_idx" ON "approval_delegations"("organization_id", "delegate_employee_id");

ALTER TABLE "approval_delegations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_delegations" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "approval_delegations";
CREATE POLICY "tenant_isolation_policy" ON "approval_delegations"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
