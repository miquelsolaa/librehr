-- 0015_tenant_column_defaults_and_roles.sql
-- Ensure unprivileged application role exists with appropriate permissions for RLS enforcement,
-- and set organization_id column defaults across all tenant tables using the tenant session context.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    CREATE ROLE librehr_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD 'librehr_dev_password';
  END IF;

  GRANT USAGE ON SCHEMA public TO librehr_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO librehr_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO librehr_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO librehr_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO librehr_app;
  REVOKE UPDATE, DELETE ON "time_events", "audit_log", "leave_ledger" FROM librehr_app;

  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'openhr_app') THEN
    GRANT USAGE ON SCHEMA public TO openhr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openhr_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openhr_app;
    REVOKE UPDATE, DELETE ON "time_events", "audit_log", "leave_ledger" FROM openhr_app;
  END IF;
END $$;

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
