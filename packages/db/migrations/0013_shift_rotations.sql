-- Migration 0013_shift_rotations.sql
-- Shift Rosters & Continuous Cycle Working Systems (TIM-004, TIM-005)

CREATE TABLE IF NOT EXISTS "shift_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "type" text NOT NULL DEFAULT 'morning',
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "color" text NOT NULL DEFAULT '#3b82f6',
  "break_minutes" integer NOT NULL DEFAULT 30,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shift_templates_org_idx" ON "shift_templates"("organization_id");
CREATE INDEX IF NOT EXISTS "shift_templates_code_idx" ON "shift_templates"("organization_id", "code");

ALTER TABLE "shift_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_templates" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "shift_templates";
CREATE POLICY "tenant_isolation_policy" ON "shift_templates"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE IF NOT EXISTS "shift_patterns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "cycle_days" integer NOT NULL DEFAULT 8,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shift_patterns_org_idx" ON "shift_patterns"("organization_id");

ALTER TABLE "shift_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_patterns" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "shift_patterns";
CREATE POLICY "tenant_isolation_policy" ON "shift_patterns"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE IF NOT EXISTS "shift_pattern_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "pattern_id" uuid NOT NULL REFERENCES "shift_patterns"("id") ON DELETE CASCADE,
  "step_order" integer NOT NULL,
  "shift_template_id" uuid REFERENCES "shift_templates"("id") ON DELETE SET NULL,
  "is_rest" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shift_pattern_steps_pattern_idx" ON "shift_pattern_steps"("pattern_id");
CREATE INDEX IF NOT EXISTS "shift_pattern_steps_org_idx" ON "shift_pattern_steps"("organization_id");

ALTER TABLE "shift_pattern_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_pattern_steps" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "shift_pattern_steps";
CREATE POLICY "tenant_isolation_policy" ON "shift_pattern_steps"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE IF NOT EXISTS "shift_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "shift_template_id" uuid REFERENCES "shift_templates"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'scheduled',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shift_assignments_org_date_idx" ON "shift_assignments"("organization_id", "date");
CREATE INDEX IF NOT EXISTS "shift_assignments_emp_date_idx" ON "shift_assignments"("employee_id", "date");

ALTER TABLE "shift_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_assignments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "shift_assignments";
CREATE POLICY "tenant_isolation_policy" ON "shift_assignments"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE IF NOT EXISTS "shift_swaps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "requester_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "target_employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "requester_date" date NOT NULL,
  "target_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "approver_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shift_swaps_org_idx" ON "shift_swaps"("organization_id");
CREATE INDEX IF NOT EXISTS "shift_swaps_requester_idx" ON "shift_swaps"("requester_id");
CREATE INDEX IF NOT EXISTS "shift_swaps_target_idx" ON "shift_swaps"("target_employee_id");

ALTER TABLE "shift_swaps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_swaps" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "shift_swaps";
CREATE POLICY "tenant_isolation_policy" ON "shift_swaps"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
