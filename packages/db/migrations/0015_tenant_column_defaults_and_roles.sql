-- 0015_tenant_column_defaults_and_roles.sql
-- 1. Demote owner role from superuser if set, ensuring PostgreSQL enforces FORCE ROW LEVEL SECURITY
-- 2. Standardize tenant isolation policies from RESTRICTIVE to standard PERMISSIVE
-- 3. Set organization_id column defaults across all tenant tables using the tenant session context
-- 4. Ensure application roles exist with proper permissions

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner' AND rolsuper = true) THEN
    ALTER ROLE librehr_owner NOSUPERUSER;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    CREATE ROLE librehr_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD 'librehr_dev_password';
  END IF;

  GRANT USAGE ON SCHEMA public TO librehr_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO librehr_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO librehr_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO librehr_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO librehr_app;

  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'openhr_app') THEN
    GRANT USAGE ON SCHEMA public TO openhr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openhr_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openhr_app;
  END IF;
END $$;

-- Convert RESTRICTIVE policies on tenant tables to standard PERMISSIVE tenant policies
DROP POLICY IF EXISTS departments_tenant_isolation ON departments;
CREATE POLICY departments_tenant_isolation ON departments
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS invitations_tenant_isolation ON invitations;
CREATE POLICY invitations_tenant_isolation ON invitations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS leave_types_tenant_isolation ON leave_types;
CREATE POLICY leave_types_tenant_isolation ON leave_types
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS leave_policies_tenant_isolation ON leave_policies;
CREATE POLICY leave_policies_tenant_isolation ON leave_policies
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS leave_policy_assignments_tenant_isolation ON leave_policy_assignments;
CREATE POLICY leave_policy_assignments_tenant_isolation ON leave_policy_assignments
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS holiday_calendars_tenant_isolation ON holiday_calendars;
CREATE POLICY holiday_calendars_tenant_isolation ON holiday_calendars
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS holidays_tenant_isolation ON holidays;
CREATE POLICY holidays_tenant_isolation ON holidays
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS leave_requests_tenant_isolation ON leave_requests;
CREATE POLICY leave_requests_tenant_isolation ON leave_requests
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;
CREATE POLICY notifications_tenant_isolation ON notifications
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Set default organization_id to app.current_org for all tables that have organization_id
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(''app.current_org'', true), '''')::uuid', tbl);
  END LOOP;
END $$;
