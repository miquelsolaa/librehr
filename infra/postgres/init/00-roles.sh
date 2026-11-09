#!/bin/sh
# 00-roles.sh: run once by the postgres image entrypoint on a fresh data volume.
#
# Creates the LibreHR roles with passwords taken from the environment (never
# hard-coded) and hands the database to the owner role so migrations do not
# need the bootstrap superuser.
#
#   librehr_owner  NOSUPERUSER, owns the database/schema and runs migrations.
#                  BYPASSRLS is kept for now because every tenant table uses
#                  FORCE ROW LEVEL SECURITY: migrations that backfill data and
#                  the API's identity lookups (until they move to SECURITY
#                  DEFINER functions) must see rows across tenants.
#   librehr_app    NOSUPERUSER NOBYPASSRLS, the runtime role; always bound by RLS.
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
  NOREPLICATION BYPASSRLS PASSWORD :'owner_password';

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
