-- Migration 0008_kiosk_time_bank.sql
-- Tablet Kiosk PIN clocking (TIM-010) and Time Bank / Compensatory Rest (TIM-012)

-- 1. Alter employees table to add kiosk pin and badge support
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "pin_hash" text;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "pin_salt" text;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "badge_id" text;

CREATE INDEX IF NOT EXISTS "employees_badge_idx" ON "employees"("organization_id", "badge_id");

-- 2. Create time_bank_records table
CREATE TABLE IF NOT EXISTS "time_bank_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "type" text NOT NULL, -- overtime_accrual, compensatory_rest_taken, manual_adjustment, expired
  "minutes" integer NOT NULL,
  "reference_date" date NOT NULL,
  "notes" text,
  "actor_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "time_bank_records_org_idx" ON "time_bank_records"("organization_id");
CREATE INDEX IF NOT EXISTS "time_bank_records_emp_idx" ON "time_bank_records"("organization_id", "employee_id");

ALTER TABLE "time_bank_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_bank_records" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "time_bank_records";
CREATE POLICY "tenant_isolation_policy" ON "time_bank_records"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
