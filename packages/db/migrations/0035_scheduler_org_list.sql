-- 0035_scheduler_org_list.sql
-- Issue #115 (LEA-002, TIM-002, TIM-003, ADM-005): the worker's scheduler
-- lists every organization with its time zone, so it can enqueue each
-- organization's periodic jobs in that organization's local time.
--
-- This is the only cross-tenant read the scheduler makes. It goes through one
-- narrowly scoped SECURITY DEFINER function that returns organization ids and
-- IANA time zones and nothing else (no names, slugs, settings or tenant rows).
-- Everything a job then reads or writes goes through withTenant and RLS.
--
-- * Owned by librehr_owner, the role the worker connects as (see
--   infra/compose/docker-compose.yml). EXECUTE is revoked from PUBLIC and
--   from librehr_app, so the API's runtime role cannot enumerate tenants
--   through it; only the owner (implicitly) may call it.
-- * search_path is pinned and every name is schema-qualified.
-- * No RLS is disabled and no role gains BYPASSRLS. `organizations` is a
--   global table (no RLS, see 0019), so the function needs no lookup policy;
--   if RLS is ever added to it, this function must get a matching
--   owner-scoped policy like the identity lookups of 0019/0020.

CREATE OR REPLACE FUNCTION librehr_scheduler_organizations()
RETURNS TABLE (organization_id uuid, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT o.id, o.timezone
  FROM public.organizations o
  ORDER BY o.id
$$;

REVOKE ALL ON FUNCTION librehr_scheduler_organizations() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    REVOKE ALL ON FUNCTION librehr_scheduler_organizations() FROM librehr_app;
  END IF;
  -- When migrations run as another role (e.g. the bootstrap superuser on an
  -- older install), hand the function to the worker's role. A no-op when
  -- librehr_owner already runs migrations.
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner')
     AND current_user <> 'librehr_owner'
     AND pg_catalog.pg_has_role(current_user, 'librehr_owner', 'MEMBER') THEN
    ALTER FUNCTION librehr_scheduler_organizations() OWNER TO librehr_owner;
  END IF;
END $$;
