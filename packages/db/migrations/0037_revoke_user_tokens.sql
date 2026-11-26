-- 0037_revoke_user_tokens.sql
-- AUTH-003, ADM-006, issue #35: enabling 2FA revokes the account's personal
-- access tokens in every organization, not only the one the session is in.
--
-- personal_access_tokens is a tenant table (RLS forced, 0006), and the API's
-- runtime role (librehr_app) only sees the organization in app.current_org.
-- This SECURITY DEFINER function is the one path for the cross-organization
-- delete. It is modelled on the identity lookups of 0019:
--
-- * Owned by the role running migrations (librehr_owner), which has no
--   BYPASSRLS and is bound by FORCE ROW LEVEL SECURITY.
-- * Takes only the user id and returns only (id, organization_id) of the
--   tokens it deleted, so the API can audit each one in its own organization.
-- * search_path is pinned and every name is schema-qualified.
-- * EXECUTE is revoked from PUBLIC and granted to librehr_app only.
-- * No policy is added and no RLS is disabled. It finds the user's
--   organizations through the existing owner-only lookup policy (0019/0020,
--   `librehr.identity_lookup`), then deletes per organization under the
--   ordinary tenant_isolation_policy by switching app.current_org, as 0025
--   does; both settings are restored before it returns.
--
-- Rollback (forward-only in practice):
--   DROP FUNCTION public.librehr_revoke_user_tokens(uuid);

CREATE OR REPLACE FUNCTION public.librehr_revoke_user_tokens(p_user_id uuid)
RETURNS TABLE (id uuid, organization_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous_lookup text := current_setting('librehr.identity_lookup', true);
  previous_org text := current_setting('app.current_org', true);
  v_orgs uuid[];
  v_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- The organizations holding this user's tokens, read in full before any
  -- setting changes again.
  PERFORM set_config('librehr.identity_lookup', 'on', true);
  SELECT coalesce(array_agg(DISTINCT pat.organization_id), '{}')
    INTO v_orgs
    FROM public.personal_access_tokens pat
    WHERE pat.user_id = p_user_id;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous_lookup, ''), true);

  FOREACH v_org IN ARRAY v_orgs LOOP
    PERFORM set_config('app.current_org', v_org::text, true);
    RETURN QUERY
      WITH deleted AS (
        DELETE FROM public.personal_access_tokens pat
        WHERE pat.user_id = p_user_id
          AND pat.organization_id = v_org
        RETURNING pat.id, pat.organization_id
      )
      SELECT deleted.id, deleted.organization_id FROM deleted;
  END LOOP;

  PERFORM set_config('app.current_org', coalesce(previous_org, ''), true);
END
$$;

REVOKE ALL ON FUNCTION public.librehr_revoke_user_tokens(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    GRANT EXECUTE ON FUNCTION public.librehr_revoke_user_tokens(uuid) TO librehr_app;
  END IF;
END $$;
