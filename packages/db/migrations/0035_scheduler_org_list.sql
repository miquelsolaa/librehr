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
--   from librehr_app and granted to librehr_owner only.
-- * What it does and does not protect: `organizations` has no RLS today and
--   librehr_app can already SELECT it (0015 grants SELECT on all tables), so
--   this function is not what hides tenant ids from the API. It is the one
--   sanctioned path for the worker, limited to two columns. SECURITY DEFINER
--   is a no-op while caller and owner are both librehr_owner; it is kept so
--   the function keeps working if `organizations` later gets FORCE RLS plus an
--   owner-scoped policy (as the identity lookups of 0019/0020 do).
-- * search_path is pinned and every name is schema-qualified.
-- * No RLS is disabled and no role gains BYPASSRLS.
--
-- Rollback (forward-only in practice): DROP FUNCTION public.librehr_scheduler_organizations();

CREATE OR REPLACE FUNCTION public.librehr_scheduler_organizations()
RETURNS TABLE (organization_id uuid, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT o.id, o.timezone
  FROM public.organizations o
  ORDER BY o.id
$$;

REVOKE ALL ON FUNCTION public.librehr_scheduler_organizations() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    REVOKE ALL ON FUNCTION public.librehr_scheduler_organizations() FROM librehr_app;
  END IF;
  -- When migrations run as another role (e.g. the bootstrap superuser on an
  -- older install), hand the function to the worker's role. A no-op when
  -- librehr_owner already runs migrations.
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner')
     AND current_user <> 'librehr_owner'
     AND pg_catalog.pg_has_role(current_user, 'librehr_owner', 'MEMBER') THEN
    ALTER FUNCTION public.librehr_scheduler_organizations() OWNER TO librehr_owner;
  END IF;
  -- Explicit, so the worker can call it even if the hand-off above could not
  -- run (migrations run by a role outside librehr_owner).
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner') THEN
    GRANT EXECUTE ON FUNCTION public.librehr_scheduler_organizations() TO librehr_owner;
  END IF;
END $$;
