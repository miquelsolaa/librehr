-- 0041_sso_enforcement.sql
-- AUTH-004 (Business edition, issue #180): "Require SSO" (sso_configurations.enforce_sso).
--
-- Enforcement is decided per membership, never by email domain: an
-- organization whose SSO configuration is enabled with enforce_sso on refuses
-- password sessions of its members, except break-glass admins (role admin
-- with TOTP enabled). A password session binds to the user's oldest
-- membership where a password is still allowed. The API applies it only when
-- the instance has a licence granting `sso` and SSO_ENABLED is true; otherwise
-- it passes p_enforce_sso = false (and ignores password_allowed), so the
-- feature is inert and nothing is deleted (LIC-003).
--
-- Sessions now record how they were authenticated (auth_method). The session
-- lookup reports whether a password is still allowed in the session's
-- organization, so turning enforcement on takes effect at lookup time without
-- revoking anything, and lifting it restores those sessions (as EMP-007 in
-- 0021).
--
-- Rolling deploys: the 1-arg librehr_auth_session_bind_org and
-- librehr_auth_session stay unchanged, so API processes of the previous
-- release keep working (without enforcement) until they are replaced. A later
-- cleanup migration may drop them.
--
-- Rollback (manual, before any 'sso' session exists):
--   DROP FUNCTION librehr_auth_last_break_glass(text);
--   DROP FUNCTION librehr_auth_session_v2(text);
--   DROP FUNCTION librehr_auth_session_bind_org(text, boolean);
--   DROP FUNCTION librehr_auth_password_access(uuid, uuid);
--   ALTER TABLE sessions DROP COLUMN auth_method;

-- 1. How a session was authenticated. Global table without RLS (0019).
-- Existing rows were all opened with a password. A constant default does not
-- rewrite the table.
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "auth_method" text NOT NULL DEFAULT 'password';
-- The checks are added NOT VALID and validated separately: adding a valid
-- constraint scans the table under ACCESS EXCLUSIVE, which would block every
-- session lookup; VALIDATE takes only SHARE UPDATE EXCLUSIVE.
ALTER TABLE "sessions"
  DROP CONSTRAINT IF EXISTS "sessions_auth_method_check";
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_auth_method_check"
  CHECK ("auth_method" IN ('password', 'sso')) NOT VALID;
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_auth_method_check";

-- An SSO session is never checked against enforcement, so it must be pinned
-- to the organization whose identity provider signed the user in, never left
-- to bind to a default membership that may belong to another organization.
ALTER TABLE "sessions"
  DROP CONSTRAINT IF EXISTS "sessions_sso_pinned_check";
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_sso_pinned_check"
  CHECK ("auth_method" <> 'sso' OR "organization_id" IS NOT NULL) NOT VALID;
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_sso_pinned_check";

COMMENT ON COLUMN "sessions"."auth_method" IS
  'AUTH-004: how the session was authenticated (password or sso).';

-- 2. Whether a password session may open in p_organization_id:
-- 'allowed' (the organization does not enforce SSO), 'break_glass' (it does,
-- and the user is an admin there with TOTP enabled) or 'sso_required'.
-- It takes a bare user id, so only the secret-keyed functions below call it;
-- the runtime role has no EXECUTE on it (same rule as librehr_auth_membership
-- in 0021).
CREATE OR REPLACE FUNCTION librehr_auth_password_access(
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous text := current_setting('librehr.identity_lookup', true);
  v_enforces boolean;
  v_role text;
  v_two_factor boolean;
BEGIN
  PERFORM set_config('librehr.identity_lookup', 'on', true);
  SELECT EXISTS (
    SELECT 1
    FROM public.sso_configurations c
    WHERE c.organization_id = p_organization_id
      AND c.enabled
      AND c.enforce_sso
  ) INTO v_enforces;
  IF v_enforces THEN
    SELECT m.role INTO v_role
    FROM public.memberships m
    WHERE m.user_id = p_user_id AND m.organization_id = p_organization_id;
    SELECT coalesce(u.two_factor_enabled, false) INTO v_two_factor
    FROM public.users u
    WHERE u.id = p_user_id;
  END IF;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);

  IF NOT v_enforces THEN
    RETURN 'allowed';
  END IF;
  IF v_role = 'admin' AND v_two_factor THEN
    RETURN 'break_glass';
  END IF;
  RETURN 'sso_required';
END
$$;

-- 3. Session binding with enforcement. Same contract as the 1-arg version of
-- 0021 (keyed on the new session's token, honours a pinned organization,
-- skips terminated and expired memberships through librehr_auth_membership),
-- and in addition skips memberships where a password session is not allowed
-- when p_enforce_sso is true. When nothing is bound only because of that, it
-- returns one row with sso_required = true and no organization. break_glass
-- tells the API to audit the sign-in.
-- A future organization switcher must apply the same per-membership rule.
CREATE OR REPLACE FUNCTION librehr_auth_session_bind_org(
  p_token text,
  p_enforce_sso boolean
)
RETURNS TABLE (
  organization_id uuid,
  role text,
  sso_required boolean,
  break_glass boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous text := current_setting('librehr.identity_lookup', true);
  v_user uuid;
  v_pinned uuid;
  v_method text;
  v_candidates uuid[];
  v_candidate uuid;
  v_role text;
  v_access text;
  v_skipped boolean := false;
BEGIN
  -- sessions carry no RLS; memberships are read through the lookup policy.
  SELECT s.user_id, s.organization_id, s.auth_method
    INTO v_user, v_pinned, v_method
  FROM public.sessions s
  WHERE s.token = p_token AND s.expires_at > now();
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('librehr.identity_lookup', 'on', true);
  SELECT array_agg(m.organization_id ORDER BY m.created_at, m.id)
    INTO v_candidates
  FROM public.memberships m
  WHERE m.user_id = v_user
    AND (v_pinned IS NULL OR m.organization_id = v_pinned);
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);

  FOREACH v_candidate IN ARRAY coalesce(v_candidates, '{}'::uuid[]) LOOP
    v_role := NULL;
    SELECT m.role INTO v_role
    FROM public.librehr_auth_membership(v_user, v_candidate) m;
    CONTINUE WHEN v_role IS NULL;

    v_access := 'allowed';
    IF p_enforce_sso AND v_method = 'password' THEN
      v_access := public.librehr_auth_password_access(v_user, v_candidate);
    END IF;
    IF v_access = 'sso_required' THEN
      v_skipped := true;
      CONTINUE;
    END IF;

    UPDATE public.sessions SET organization_id = v_candidate
    WHERE token = p_token AND organization_id IS NULL;

    organization_id := v_candidate;
    role := v_role;
    sso_required := false;
    break_glass := v_access = 'break_glass';
    RETURN NEXT;
    RETURN;
  END LOOP;

  IF v_skipped THEN
    organization_id := NULL;
    role := NULL;
    sso_required := true;
    break_glass := false;
    RETURN NEXT;
  END IF;
END
$$;

-- 4. Session lookup with the session's auth method and whether a password is
-- allowed in its organization. A new name because CREATE OR REPLACE cannot
-- change the RETURNS TABLE of librehr_auth_session. password_allowed is
-- computed as if enforcement were active; the API ignores it when the
-- licence or SSO_ENABLED says otherwise.
CREATE OR REPLACE FUNCTION librehr_auth_session_v2(p_token text)
RETURNS TABLE (
  user_id uuid,
  email text,
  name text,
  two_factor_enabled boolean,
  organization_id uuid,
  role text,
  expires_at timestamptz,
  auth_method text,
  password_allowed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
    SELECT u.id, u.email, u.name, u.two_factor_enabled,
           m.organization_id, m.role, s.expires_at, s.auth_method,
           CASE
             WHEN s.auth_method = 'password' THEN
               public.librehr_auth_password_access(u.id, m.organization_id)
                 <> 'sso_required'
             ELSE true
           END
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    CROSS JOIN LATERAL public.librehr_auth_membership(s.user_id, s.organization_id) m
    WHERE s.token = p_token
      AND s.expires_at > now()
    LIMIT 1;
END
$$;

-- 5. Whether the session's user is the last break-glass admin of an
-- organization that requires SSO: an active admin there with TOTP, and no
-- other active admin there has TOTP. Turning TOTP off would then leave that
-- organization with no password way in if its identity provider fails, so
-- the API refuses it (409 SSO_BREAK_GLASS_REQUIRED). Keyed by the session
-- token, since a user's memberships in other organizations are not readable
-- under the tenant's RLS. Same break-glass rule as librehr_auth_password_access
-- and SsoRepository.countBreakGlassAdmins; terminated or expired memberships
-- do not count (librehr_auth_membership).
CREATE OR REPLACE FUNCTION librehr_auth_last_break_glass(p_token text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous text := current_setting('librehr.identity_lookup', true);
  v_user uuid;
  v_last boolean;
BEGIN
  SELECT s.user_id INTO v_user
  FROM public.sessions s
  WHERE s.token = p_token AND s.expires_at > now();
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  PERFORM set_config('librehr.identity_lookup', 'on', true);
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id
    JOIN public.sso_configurations c
      ON c.organization_id = m.organization_id AND c.enabled AND c.enforce_sso
    WHERE m.user_id = v_user
      AND u.two_factor_enabled
      AND EXISTS (
        SELECT 1 FROM public.librehr_auth_membership(v_user, m.organization_id) a
        WHERE a.role = 'admin'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.memberships o
        JOIN public.users ou ON ou.id = o.user_id
        WHERE o.organization_id = m.organization_id
          AND o.user_id <> v_user
          AND o.role = 'admin'
          AND ou.two_factor_enabled
          AND EXISTS (
            SELECT 1
            FROM public.librehr_auth_membership(o.user_id, o.organization_id) b
            WHERE b.role = 'admin'
          )
      )
  ) INTO v_last;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
  RETURN v_last;
END
$$;

-- 6. Privileges: the secret-keyed functions are callable by the runtime role
-- only; the bare-id helper by nobody but its owner.
REVOKE ALL ON FUNCTION librehr_auth_password_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_session_bind_org(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_session_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_last_break_glass(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    REVOKE EXECUTE ON FUNCTION librehr_auth_password_access(uuid, uuid) FROM librehr_app;
    GRANT EXECUTE ON FUNCTION
      librehr_auth_session_bind_org(text, boolean),
      librehr_auth_session_v2(text),
      librehr_auth_last_break_glass(text)
    TO librehr_app;
  END IF;
END $$;
