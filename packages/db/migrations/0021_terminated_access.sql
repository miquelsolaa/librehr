-- 0020_terminated_access.sql
-- EMP-007 (revoke access at termination), AUTH-002.
--
-- A membership whose employee record is terminated stops granting access once
-- the termination date has arrived in the organization's time zone. The check
-- runs at lookup time, so a future-dated termination takes effect on its date
-- without a background job. The terminate endpoint additionally deletes the
-- user's sessions and personal access tokens when the date is today or past.
--
-- The replaced lookup functions keep their signatures, search_path and the
-- identity_lookup pattern of 0019; only their queries change. Section 5
-- withdraws the runtime role's EXECUTE on librehr_auth_membership.

-- 1. Owner read access to employees, scoped to the lookup functions (see 0019).
DROP POLICY IF EXISTS "employees_identity_lookup" ON "employees";
CREATE POLICY "employees_identity_lookup" ON "employees"
  FOR SELECT TO CURRENT_USER
  USING (current_setting('librehr.identity_lookup', true) = 'on');

-- 2. The membership lookup skips memberships of terminated employees whose
-- termination date is today or earlier in the organization's time zone. A
-- terminated employee without a date is treated as terminated now.
CREATE OR REPLACE FUNCTION librehr_auth_membership(
  p_user_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (organization_id uuid, role text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous text := current_setting('librehr.identity_lookup', true);
BEGIN
  PERFORM set_config('librehr.identity_lookup', 'on', true);
  RETURN QUERY
    SELECT m.organization_id, m.role
    FROM public.memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id
      AND (p_organization_id IS NULL OR m.organization_id = p_organization_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.organization_id = m.organization_id
          AND e.user_id = m.user_id
          AND e.status = 'terminated'
          AND (
            e.termination_date IS NULL
            OR e.termination_date <= (now() AT TIME ZONE o.timezone)::date
          )
      )
    ORDER BY m.created_at, m.id
    LIMIT 1;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- 3. Personal access tokens resolve their membership through the same
-- function, so a terminated owner's tokens stop working too.
CREATE OR REPLACE FUNCTION librehr_auth_personal_access_token(p_token_hash text)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  user_id uuid,
  scopes jsonb,
  email text,
  user_name text,
  role text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous text := current_setting('librehr.identity_lookup', true);
BEGIN
  PERFORM set_config('librehr.identity_lookup', 'on', true);
  RETURN QUERY
    SELECT pat.id, pat.organization_id, pat.user_id, pat.scopes,
           u.email, u.name, m.role
    FROM public.personal_access_tokens pat
    JOIN public.users u ON u.id = pat.user_id
    CROSS JOIN LATERAL public.librehr_auth_membership(pat.user_id, pat.organization_id) m
    WHERE pat.token_hash = p_token_hash
      AND (pat.expires_at IS NULL OR pat.expires_at > now())
    LIMIT 1;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- 4. Bind a new session to an organization. Sign-in and 2FA verification
-- hold a freshly created session token (the secret) but no organization yet:
-- this picks the session's pinned organization or, when it is NULL, the
-- user's default membership (same rule as librehr_auth_membership), stores it
-- on the session and returns it with the role. Nothing is returned when the
-- session is unknown or expired or the user has no active membership there.
CREATE OR REPLACE FUNCTION librehr_auth_session_bind_org(p_token text)
RETURNS TABLE (organization_id uuid, role text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_pinned uuid;
  v_org uuid;
  v_role text;
BEGIN
  -- sessions carry no RLS; the membership comes from the function.
  SELECT s.user_id, s.organization_id INTO v_user, v_pinned
  FROM public.sessions s
  WHERE s.token = p_token AND s.expires_at > now();
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT m.organization_id, m.role INTO v_org, v_role
  FROM public.librehr_auth_membership(v_user, v_pinned) m;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.sessions SET organization_id = v_org
  WHERE token = p_token AND organization_id IS NULL;

  organization_id := v_org;
  role := v_role;
  RETURN NEXT;
END
$$;

-- 5. Privileges. librehr_auth_membership takes no secret: anyone able to call
-- it could map every user id to its organizations and roles across tenants.
-- The runtime role loses EXECUTE on it; the secret-keyed functions
-- (librehr_auth_session, librehr_auth_personal_access_token and
-- librehr_auth_session_bind_org) still call it internally as the owner.
REVOKE ALL ON FUNCTION librehr_auth_membership(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_personal_access_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_session_bind_org(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    REVOKE EXECUTE ON FUNCTION librehr_auth_membership(uuid, uuid) FROM librehr_app;
    GRANT EXECUTE ON FUNCTION
      librehr_auth_personal_access_token(text),
      librehr_auth_session_bind_org(text)
    TO librehr_app;
  END IF;
END $$;

-- 6. The lookup above filters employees by (organization_id, user_id).
CREATE INDEX IF NOT EXISTS "employees_org_user_idx"
  ON "employees" ("organization_id", "user_id");

-- Bind the new lookup policy to the role that owns the SECURITY DEFINER
-- functions (same reasoning as 0020_identity_lookup_policy_owner.sql).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner') THEN
    ALTER POLICY "employees_identity_lookup" ON "employees" TO librehr_owner;
  END IF;
END $$;
