-- OpenHR Migration 0004: Time Tracking (Registro de Jornada), Schedules, Rules, and Corrections (M3)

-- 1. Schedules table
CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'fixed',
  weekly_hours numeric(5, 2) NOT NULL DEFAULT 40.00,
  minimum_daily_rest_hours numeric(4, 1) NOT NULL DEFAULT 12.0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedules_org_idx ON schedules(organization_id);

-- 2. Schedule rules table (daily rules)
CREATE TABLE IF NOT EXISTS schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL,
  expected_hours numeric(4, 2) NOT NULL DEFAULT 8.00,
  core_start_minutes integer,
  core_end_minutes integer,
  break_minutes integer DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_rules_schedule_idx ON schedule_rules(schedule_id);

-- 3. Employee schedule assignments
CREATE TABLE IF NOT EXISTS employee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_schedules_employee_idx ON employee_schedules(employee_id);
CREATE INDEX IF NOT EXISTS employee_schedules_schedule_idx ON employee_schedules(schedule_id);

-- 4. Time corrections table
CREATE TABLE IF NOT EXISTS time_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ref_event_id uuid REFERENCES time_events(id) ON DELETE SET NULL,
  proposed_event_type text NOT NULL,
  proposed_occurred_at timestamptz NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  approver_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text,
  created_event_id uuid REFERENCES time_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_corrections_org_idx ON time_corrections(organization_id);
CREATE INDEX IF NOT EXISTS time_corrections_employee_idx ON time_corrections(employee_id);

-- 5. Enable and Force RLS on all 4 new tables
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules FORCE ROW LEVEL SECURITY;

ALTER TABLE schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE employee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_schedules FORCE ROW LEVEL SECURITY;

ALTER TABLE time_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_corrections FORCE ROW LEVEL SECURITY;

-- 6. Tenant isolation policies
DROP POLICY IF EXISTS tenant_isolation_policy ON schedules;
CREATE POLICY tenant_isolation_policy ON schedules
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON schedule_rules;
CREATE POLICY tenant_isolation_policy ON schedule_rules
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON employee_schedules;
CREATE POLICY tenant_isolation_policy ON employee_schedules
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON time_corrections;
CREATE POLICY tenant_isolation_policy ON time_corrections
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
