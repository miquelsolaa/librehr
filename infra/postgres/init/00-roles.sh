#!/bin/sh
# 00-roles.sh: run once by the postgres image entrypoint on a fresh data volume.
#
# Creates the LibreHR roles with passwords taken from the environment (never
# hard-coded) and hands the database to the owner role so migrations do not
# need the bootstrap superuser.
#
#   librehr_owner  NOSUPERUSER NOBYPASSRLS, owns the database/schema, runs
#                  migrations and the worker (pg-boss schema). FORCE ROW LEVEL
#                  SECURITY binds it too: no migration backfills tenant rows
#                  across organizations, and the pre-tenant identity lookups
#                  go through the SECURITY DEFINER functions of migration 0019.
#   librehr_app    NOSUPERUSER NOBYPASSRLS, the API's runtime role
#                  (DATABASE_URL); always bound by RLS.
#
# Required env: LIBREHR_OWNER_PASSWORD, LIBREHR_APP_PASSWORD.
set -eu

: "${LIBREHR_OWNER_PASSWORD:?LIBREHR_OWNER_PASSWORD must be set for the postgres service}"
: "${LIBREHR_APP_PASSWORD:?LIBREHR_APP_PASSWORD must be set for the postgres service}"

librehr_db="${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"

# Passwords travel as psql variables (:'name' quotes them as literals), so they
# are never interpolated into SQL by the shell nor printed by `set -x`.
psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" \
  --dbname "$librehr_db" \
  -v owner_password="$LIBREHR_OWNER_PASSWORD" \
  -v app_password="$LIBREHR_APP_PASSWORD" \
  -v db_name="$librehr_db" <<'SQL'
SELECT 'CREATE ROLE librehr_owner'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner')
\gexec
ALTER ROLE librehr_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'owner_password';

SELECT 'CREATE ROLE librehr_app'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app')
\gexec
ALTER ROLE librehr_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOINHERIT NOBYPASSRLS PASSWORD :'app_password';

-- The owner role runs migrations: give it the database and the public schema.
ALTER DATABASE :"db_name" OWNER TO librehr_owner;
ALTER SCHEMA public OWNER TO librehr_owner;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO librehr_app;

-- Extensions used by migration 0000. They are trusted on PostgreSQL >= 13, but
-- creating them here as the bootstrap superuser keeps the owner role free of
-- any extension privileges; the migration's IF NOT EXISTS is then a no-op.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
SQL
