-- 0001_rls_and_triggers.sql
-- Enables and forces Row-Level Security on all tenant tables and sets up append-only protection

-- 1. Function to enforce append-only invariant
CREATE OR REPLACE FUNCTION openhr_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only. UPDATE and DELETE operations are strictly prohibited.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- 2. Tenant isolation RLS policies for every table with organization_id

-- legal_entities
ALTER TABLE "legal_entities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_entities" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "legal_entities_tenant_isolation" ON "legal_entities";
CREATE POLICY "legal_entities_tenant_isolation" ON "legal_entities"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- locations
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "locations_tenant_isolation" ON "locations";
CREATE POLICY "locations_tenant_isolation" ON "locations"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- memberships
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memberships_tenant_isolation" ON "memberships";
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- employees
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employees_tenant_isolation" ON "employees";
CREATE POLICY "employees_tenant_isolation" ON "employees"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- employments
ALTER TABLE "employments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employments_tenant_isolation" ON "employments";
CREATE POLICY "employments_tenant_isolation" ON "employments"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- leave_ledger (Tenant + Append-only)
ALTER TABLE "leave_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_ledger_tenant_isolation" ON "leave_ledger";
CREATE POLICY "leave_ledger_tenant_isolation" ON "leave_ledger"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
DROP TRIGGER IF EXISTS "prevent_mod_leave_ledger" ON "leave_ledger";
CREATE TRIGGER "prevent_mod_leave_ledger"
  BEFORE UPDATE OR DELETE ON "leave_ledger"
  FOR EACH ROW EXECUTE FUNCTION openhr_prevent_modification();

-- time_events (Tenant + Append-only)
ALTER TABLE "time_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_events_tenant_isolation" ON "time_events";
CREATE POLICY "time_events_tenant_isolation" ON "time_events"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
DROP TRIGGER IF EXISTS "prevent_mod_time_events" ON "time_events";
CREATE TRIGGER "prevent_mod_time_events"
  BEFORE UPDATE OR DELETE ON "time_events"
  FOR EACH ROW EXECUTE FUNCTION openhr_prevent_modification();

-- audit_log (Tenant + Append-only)
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log_tenant_isolation" ON "audit_log";
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
DROP TRIGGER IF EXISTS "prevent_mod_audit_log" ON "audit_log";
CREATE TRIGGER "prevent_mod_audit_log"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION openhr_prevent_modification();

-- 3. Revoke UPDATE and DELETE permissions from application role
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'openhr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openhr_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openhr_app;
    REVOKE UPDATE, DELETE ON "time_events", "audit_log", "leave_ledger" FROM openhr_app;
  END IF;
END $$;
