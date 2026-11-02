-- Migration 0007_org_self_service.sql
-- Teams (ORG-003), Custom Fields (ORG-005), Emergency Contacts (EMP-002)

-- 1. Teams (ORG-003)
CREATE TABLE IF NOT EXISTS "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "department_id" uuid REFERENCES "departments"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "lead_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "teams_org_idx" ON "teams"("organization_id");
CREATE INDEX IF NOT EXISTS "teams_dept_idx" ON "teams"("department_id");

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "teams";
CREATE POLICY "tenant_isolation_policy" ON "teams"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 2. Custom Field Definitions (ORG-005)
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "field_type" text NOT NULL,
  "options" text,
  "required" boolean NOT NULL DEFAULT false,
  "visibility" text NOT NULL DEFAULT 'employee',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cfd_org_idx" ON "custom_field_definitions"("organization_id");
CREATE INDEX IF NOT EXISTS "cfd_org_code_idx" ON "custom_field_definitions"("organization_id", "code");

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "custom_field_definitions";
CREATE POLICY "tenant_isolation_policy" ON "custom_field_definitions"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 3. Custom Field Values (ORG-005)
CREATE TABLE IF NOT EXISTS "custom_field_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "field_definition_id" uuid NOT NULL REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "value" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cfv_org_idx" ON "custom_field_values"("organization_id");
CREATE INDEX IF NOT EXISTS "cfv_employee_idx" ON "custom_field_values"("employee_id");
CREATE INDEX IF NOT EXISTS "cfv_field_idx" ON "custom_field_values"("field_definition_id");

ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "custom_field_values";
CREATE POLICY "tenant_isolation_policy" ON "custom_field_values"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 4. Emergency Contacts (EMP-002)
CREATE TABLE IF NOT EXISTS "emergency_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "full_name" text NOT NULL,
  "relationship" text NOT NULL,
  "phone_primary" text NOT NULL,
  "phone_secondary" text,
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "emergency_contacts_org_idx" ON "emergency_contacts"("organization_id");
CREATE INDEX IF NOT EXISTS "emergency_contacts_emp_idx" ON "emergency_contacts"("employee_id");

ALTER TABLE "emergency_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emergency_contacts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "emergency_contacts";
CREATE POLICY "tenant_isolation_policy" ON "emergency_contacts"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
