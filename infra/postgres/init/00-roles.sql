-- 00-roles.sql
-- Setup owner role for migrations and unprivileged application role with strict RLS enforcement.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'openhr_owner') THEN
    CREATE ROLE openhr_owner WITH LOGIN SUPERUSER PASSWORD 'openhr_dev_password';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'openhr_app') THEN
    -- Strict least-privilege: NOSUPERUSER NOBYPASSRLS prevents bypassing Row-Level Security
    CREATE ROLE openhr_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD 'openhr_dev_password';
  END IF;
END $$;

GRANT ALL PRIVILEGES ON DATABASE openhr TO openhr_owner;
GRANT CONNECT ON DATABASE openhr TO openhr_app;
