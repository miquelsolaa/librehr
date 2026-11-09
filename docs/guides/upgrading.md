# Upgrading LibreHR

All LibreHR database migrations are designed to be forward-only and safe to run on populated production databases without downtime.

## Standard Upgrade Workflow

1. **Create a fresh pre-upgrade backup:**

   ```bash
   ./infra/scripts/backup.sh /var/backups/librehr
   ```

2. **Pull latest release / code:**

   ```bash
   git pull origin main
   # or pull latest release container tags
   docker compose --env-file .env -f infra/compose/docker-compose.yml pull
   ```

3. **Run database migrations:**

   ```bash
   pnpm db:migrate
   ```

   _Note: LibreHR migrations use PostgreSQL advisory locks to guarantee that multiple concurrent instances will not execute duplicate migrations simultaneously._

4. **Restart services:**

   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml up -d
   ```

5. **Verify health:**
   ```bash
   curl -f http://localhost:3001/readyz
   ```

## Hashed session and invitation tokens (migration 0026)

Session tokens and invitation-link tokens are now stored as SHA-256 digests
instead of in plain text, so a database dump or backup no longer contains
usable sessions or invitation links. Migration `0026_hash_bearer_tokens.sql`
rewrites the existing rows: signed-in users stay signed in and pending
invitation links keep working.

- Run the migration and start the new API together. An older API still running
  after the migration would write raw tokens that the new code never matches
  (its users would just have to sign in again).
- The migration briefly lifts `FORCE ROW LEVEL SECURITY` on `invitations`
  inside its own transaction, which requires the migration role to own the
  table. Installs that completed
  [the restricted-roles upgrade](#upgrading-existing-installs-to-the-restricted-database-roles)
  already satisfy this.
- Backups taken before this upgrade still contain raw tokens. They expire
  (sessions after 7 days, invitations after 7 days), but protect and expire
  those backups under your retention policy.

## pg-boss queue policy

The worker creates its queues with the `exclusive` policy so that a job sent
with a `singletonKey` (for example one accrual run per organization and date)
is not queued twice. pg-boss never changes the policy of a queue that already
exists, so a database whose queues were created by an earlier version keeps
the `standard` policy, where `singletonKey` does not deduplicate. At startup
the worker logs a warning for each such queue (`msg: "pg-boss queue has an
unexpected policy..."` with `queue`, `actualPolicy` and `expectedPolicy`).

To fix a queue named in that warning:

1. Stop whatever enqueues to the queue (for the scheduled queues, nothing
   else is needed) and wait until it is empty:

   ```sql
   SELECT state, count(*) FROM pgboss.job WHERE name = '<queue>' GROUP BY state;
   ```

   Only `completed`, `cancelled` or `failed` rows should remain. Note any
   `failed` jobs you still want to re-drive.

2. Stop the worker, then delete the queue (this also deletes its job rows):

   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml stop worker
   docker compose --env-file .env -f infra/compose/docker-compose.yml run --rm -w /app/apps/worker worker \
     node --input-type=module -e "import { PgBoss } from 'pg-boss'; const b = new PgBoss({ connectionString: process.env.DATABASE_MIGRATION_URL, schema: 'pgboss' }); await b.start(); await b.deleteQueue(process.argv[1]); await b.stop();" '<queue>'
   ```

3. Start the worker. It recreates the queue with the `exclusive` policy and
   the warning no longer appears.

## Upgrading existing installs to the restricted database roles

From this release the API serves every request as the `librehr_app` role
(`NOSUPERUSER`, `NOBYPASSRLS`), so PostgreSQL Row-Level Security isolates
organizations even if application code has a bug. Migrations and the worker
run as `librehr_owner`, which also loses `BYPASSRLS`. Identity lookups that
happen before an organization is known (sign-in, sessions, personal access
tokens, invitation links, SSO discovery) go through narrow `SECURITY DEFINER`
functions added by migration `0019`.

Installs created from the current `infra/postgres/init/00-roles.sh` only need
step 4. Older installs, where `DATABASE_URL` pointed at the bootstrap superuser
(`POSTGRES_USER`) or migrations ran as that user, need all steps. Do them
**before** starting the new version, so migrations `0018` and `0019` run as
`librehr_owner`.

1. **Back up** the database (see the standard workflow above) and stop `api`
   and `worker`.

2. **Choose passwords** for both roles (`openssl rand -hex 32` each) and put
   them in `.env` as `LIBREHR_OWNER_PASSWORD` and `LIBREHR_APP_PASSWORD`. The
   init script never runs again on an existing volume, so the next step applies
   them. Use hex, not base64: these passwords end up inside
   `postgres://user:password@host` URLs, where base64's `/` and `+` break
   parsing. A password you choose yourself must be URL-encoded in the URL
   (`/` as `%2F`, `+` as `%2B`, `@` as `%40`, ...); the API and worker refuse
   to start with an unparseable database URL.

3. **Fix roles, ownership and grants** as the bootstrap superuser. Save the
   script below as `upgrade-roles.sql` and run it with the passwords passed as
   psql variables (they are quoted as literals and never echoed):

   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml cp upgrade-roles.sql postgres:/tmp/upgrade-roles.sql
   docker compose --env-file .env -f infra/compose/docker-compose.yml exec postgres sh -c      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v owner_password="$LIBREHR_OWNER_PASSWORD" -v app_password="$LIBREHR_APP_PASSWORD" -f /tmp/upgrade-roles.sql'
   ```

   The script creates the roles if they are missing, removes `BYPASSRLS` from
   both, and hands every object in the `public` and `pgboss` schemas created by
   the bootstrap superuser to `librehr_owner`. It does this object by object
   because `REASSIGN OWNED BY <bootstrap user> TO librehr_owner` is refused for
   the bootstrap superuser of the official image ("required by the database
   system"). Extension objects stay with the superuser. Everything runs in one
   transaction.

   ```sql
   \set ON_ERROR_STOP on
   BEGIN;

   -- 1. Roles: create them if missing, then enforce their attributes.
   SELECT 'CREATE ROLE librehr_owner'
   WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'librehr_owner') \gexec
   SELECT 'CREATE ROLE librehr_app'
   WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'librehr_app') \gexec
   ALTER ROLE librehr_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOBYPASSRLS PASSWORD :'owner_password';
   ALTER ROLE librehr_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOINHERIT NOBYPASSRLS PASSWORD :'app_password';

   -- 2. Hand objects created by the bootstrap superuser to librehr_owner.
   --    (REASSIGN OWNED BY is refused for the bootstrap superuser of the
   --    official image, because it also owns the system catalogs.)
   DO $$
   DECLARE
     stmt text;
   BEGIN
     FOR stmt IN
       SELECT format('ALTER %s %s OWNER TO librehr_owner',
                     CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                                    WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
                     c.oid::regclass)
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('public', 'pgboss')
         AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
         AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
         -- sequences owned by a column follow their table
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                           AND d.deptype IN ('a', 'i'))
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                           AND d.deptype = 'e')
       UNION ALL
       SELECT format('ALTER %s %s OWNER TO librehr_owner',
                     CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
                     p.oid::regprocedure)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'pgboss')
         AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
         -- functions of extensions (pgcrypto, uuid-ossp, btree_gist) stay put
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                           AND d.deptype = 'e')
       UNION ALL
       SELECT format('ALTER TYPE %s OWNER TO librehr_owner', t.oid::regtype)
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname IN ('public', 'pgboss')
         AND t.typtype IN ('e', 'd')
         AND t.typowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid
                           AND d.deptype = 'e')
       UNION ALL
       SELECT format('ALTER SCHEMA %I OWNER TO librehr_owner', n.nspname)
       FROM pg_namespace n
       WHERE n.nspname IN ('public', 'pgboss')
     LOOP
       EXECUTE stmt;
     END LOOP;
   END $$;
   SELECT format('ALTER DATABASE %I OWNER TO librehr_owner', current_database()) \gexec

   -- 2b. The identity-lookup policies of migration 0019 were created for the
   --     role that ran it. The lookup functions now run as librehr_owner, so
   --     the policies must apply to it too (migration 0020 repeats this).
   --     Skipped automatically when 0019 has not run yet.
   DO $$
   DECLARE
     pol record;
   BEGIN
     FOR pol IN
       SELECT policyname, tablename
       FROM pg_policies
       WHERE schemaname = 'public'
         AND policyname IN ('memberships_identity_lookup',
                            'personal_access_tokens_identity_lookup',
                            'invitations_identity_lookup',
                            'sso_configurations_identity_lookup')
     LOOP
       EXECUTE format('ALTER POLICY %I ON public.%I TO librehr_owner',
                      pol.policyname, pol.tablename);
     END LOOP;
   END $$;

   -- 3. Runtime role privileges, including on tables the owner creates later.
   SELECT format('GRANT CONNECT ON DATABASE %I TO librehr_app', current_database()) \gexec
   GRANT USAGE ON SCHEMA public TO librehr_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO librehr_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO librehr_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE librehr_owner IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO librehr_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE librehr_owner IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO librehr_app;
   -- Append-only tables never accept UPDATE/DELETE (migration 0018 repeats this).
   REVOKE UPDATE, DELETE, TRUNCATE ON time_events, leave_ledger, audit_log FROM librehr_app;

   COMMIT;
   ```

4. **Point the API at the runtime role.** The bundled compose file now sets
   `DATABASE_URL` to `librehr_app` and `DATABASE_MIGRATION_URL` to
   `librehr_owner`. If you maintain your own compose file or environment, set:

   ```text
   DATABASE_URL=postgres://librehr_app:<LIBREHR_APP_PASSWORD>@postgres:5432/librehr
   DATABASE_MIGRATION_URL=postgres://librehr_owner:<LIBREHR_OWNER_PASSWORD>@postgres:5432/librehr
   ```

   `DATABASE_APP_URL` is no longer used; remove it. The worker keeps
   `DATABASE_MIGRATION_URL` (it owns the `pgboss` schema) and no longer needs
   `DATABASE_URL`.

5. **Start the stack** and check the roles:

   ```sql
   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'librehr_%';
   ```

   Both roles must show `f` / `f`. Existing sessions keep working: sessions
   created before this release open in the user's oldest membership.
