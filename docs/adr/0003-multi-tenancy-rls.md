# ADR 0003: Multi-Tenancy Architecture and Row-Level Security (RLS)

## Status

Accepted

## Date

2026-11-01

## Context

OpenHR must simultaneously support two deployment topologies:

1. **Single-tenant:** A self-hoster running one organization using `docker compose up`.
2. **Multi-tenant:** A managed hosting provider or business group running hundreds of organizations on a shared PostgreSQL cluster.

Data leakage between tenants in an HRIS is an unacceptable, catastrophic failure. Application-level filtering (`WHERE organization_id = ?`) is prone to developer oversight, join omissions, and subtle bugs.

## Decision

We enforce multi-tenancy at the PostgreSQL storage engine level using Row-Level Security (RLS) policies:

1. **Schema Design:**
   - Every tenant table contains a non-nullable `organization_id UUID` column with a foreign key referencing `organizations(id)`.
   - `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;`
   - `ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;` (`FORCE` ensures table owners and superusers are also bound by RLS unless explicitly running migration scripts).

2. **Session Variable Context:**
   - Every database transaction must establish its execution context using `withTenant(ctx, tx => ...)`:
     ```sql
     SELECT set_config('app.current_org', $1, true);
     SELECT set_config('app.current_user', $2, true);
     ```
   - The third parameter `true` scopes the variable strictly to the current transaction (`SET LOCAL`), preventing context bleed across pooled connections.

3. **RLS Policy Predicate:**
   - Standard policy:
     ```sql
     CREATE POLICY org_isolation_policy ON <table_name>
       AS RESTRICTIVE
       USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
       WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
     ```
   - If `app.current_org` is not set or empty, `NULLIF` evaluates to `NULL`, which fails equality against `organization_id`, resulting in 0 rows returned (or check violation on insert/update).

4. **Connection Privileges:**
   - The application connects using the unprivileged `openhr_app` database user.
   - Migrations and schema adjustments run under the administrative `openhr_migration` user.

## Consequences

- Queries that accidentally omit `WHERE organization_id = ...` cannot see or modify data belonging to other tenants.
- Any query run outside of a `withTenant` block returns empty result sets, guaranteeing secure defaults.
- Cross-tenant data isolation is provable by integration tests (`packages/db/test/rls-isolation.int.test.ts` and `apps/api/test/tenant-isolation.int.test.ts`).
