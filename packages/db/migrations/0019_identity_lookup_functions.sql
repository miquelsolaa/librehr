-- 0019_identity_lookup_functions.sql
-- AUTH-001/002, ORG-006, ADM-006: identity lookups for the restricted runtime role.
--
-- The API connects as librehr_app (NOSUPERUSER, NOBYPASSRLS). users, sessions
-- and organizations are global tables without RLS, so it reads them directly.
-- memberships, personal_access_tokens, invitations and sso_configurations are
-- tenant tables, yet must be read before a tenant context exists (sign-in,
-- session and token resolution, invitation links, SSO discovery). The
-- SECURITY DEFINER functions below are the only path for that: each takes the
-- secret or key the caller already holds and returns the minimal columns.
--
-- The functions are owned by the role running migrations (librehr_owner). That
-- role has no BYPASSRLS and FORCE ROW LEVEL SECURITY applies to it, so each
-- table gets a SELECT-only policy for the owner that is active only while
-- `librehr.identity_lookup` is 'on'. Only these functions switch it on, for
-- the duration of their query. The policies never apply to librehr_app, so
-- the runtime role cannot use the setting to widen its own reads.

-- 1. Sessions remember the organization the user signed into (nullable:
-- sessions created before this migration resolve the default membership).
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "organization_id" uuid
  REFERENCES "organizations"("id") ON DELETE CASCADE;

-- 2. Owner read access, scoped to the lookup functions.
DROP POLICY IF EXISTS "memberships_identity_lookup" ON "memberships";
CREATE POLICY "memberships_identity_lookup" ON "memberships"
  FOR SELECT TO CURRENT_USER
  USING (current_setting('librehr.identity_lookup', true) = 'on');

DROP POLICY IF EXISTS "personal_access_tokens_identity_lookup" ON "personal_access_tokens";
CREATE POLICY "personal_access_tokens_identity_lookup" ON "personal_access_tokens"
  FOR SELECT TO CURRENT_USER
  USING (current_setting('librehr.identity_lookup', true) = 'on');

DROP POLICY IF EXISTS "invitations_identity_lookup" ON "invitations";
CREATE POLICY "invitations_identity_lookup" ON "invitations"
  FOR SELECT TO CURRENT_USER
  USING (current_setting('librehr.identity_lookup', true) = 'on');

DROP POLICY IF EXISTS "sso_configurations_identity_lookup" ON "sso_configurations";
CREATE POLICY "sso_configurations_identity_lookup" ON "sso_configurations"
  FOR SELECT TO CURRENT_USER
  USING (current_setting('librehr.identity_lookup', true) = 'on');

-- 3. Lookup functions. Each one switches librehr.identity_lookup on for its
-- own query and restores the previous value before returning. (A function
-- SET clause cannot be used: PostgreSQL only lets superusers attach custom
-- settings to a function definition.)

-- The user's membership in p_organization_id, or, when it is NULL, the
-- default one: the oldest membership by created_at, then id.
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
    WHERE m.user_id = p_user_id
      AND (p_organization_id IS NULL OR m.organization_id = p_organization_id)
    ORDER BY m.created_at, m.id
    LIMIT 1;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- An unexpired session with its user and organization. A session pinned to an
-- organization the user no longer belongs to resolves to nothing.
CREATE OR REPLACE FUNCTION librehr_auth_session(p_token text)
RETURNS TABLE (
  user_id uuid,
  email text,
  name text,
  two_factor_enabled boolean,
  organization_id uuid,
  role text,
  expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  -- sessions and users carry no RLS; the membership comes from the function.
  RETURN QUERY
    SELECT u.id, u.email, u.name, u.two_factor_enabled,
           m.organization_id, m.role, s.expires_at
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    CROSS JOIN LATERAL public.librehr_auth_membership(s.user_id, s.organization_id) m
    WHERE s.token = p_token
      AND s.expires_at > now()
    LIMIT 1;
END
$$;

-- An unexpired personal access token whose owner is still a member of the
-- token's organization.
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
    JOIN public.memberships m
      ON m.user_id = pat.user_id AND m.organization_id = pat.organization_id
    WHERE pat.token_hash = p_token_hash
      AND (pat.expires_at IS NULL OR pat.expires_at > now())
    LIMIT 1;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- An invitation by its token, with the inviting organization's name. Expiry
-- and acceptance are returned so the API can answer 410 vs 404.
CREATE OR REPLACE FUNCTION librehr_auth_invitation(p_token text)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  email text,
  role text,
  expires_at timestamptz,
  accepted_at timestamptz
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
    SELECT i.id, i.organization_id, o.name, i.email, i.role,
           i.expires_at, i.accepted_at
    FROM public.invitations i
    JOIN public.organizations o ON o.id = i.organization_id
    WHERE i.token = p_token
    LIMIT 1;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- The enabled SSO configuration that allows p_domain (case-insensitive, a
-- leading '@' in the allow-list is ignored); the oldest one wins. The client
-- secret is never returned.
CREATE OR REPLACE FUNCTION librehr_auth_sso_config(p_domain text)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  provider text,
  client_id text,
  issuer_url text,
  allowed_domains jsonb
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
    SELECT c.id, c.organization_id, c.provider, c.client_id, c.issuer_url,
           c.allowed_domains
    FROM public.sso_configurations c
    WHERE c.enabled
      AND CASE
        WHEN jsonb_typeof(c.allowed_domains) = 'array' THEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(c.allowed_domains) AS d(domain)
          WHERE regexp_replace(lower(btrim(d.domain)), '^@', '') = lower(btrim(p_domain))
        )
        ELSE false
      END
    ORDER BY c.created_at, c.id
    LIMIT 1;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- 4. Only the runtime role may call them.
REVOKE ALL ON FUNCTION librehr_auth_membership(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_personal_access_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_sso_config(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    GRANT EXECUTE ON FUNCTION
      librehr_auth_membership(uuid, uuid),
      librehr_auth_session(text),
      librehr_auth_personal_access_token(text),
      librehr_auth_invitation(text),
      librehr_auth_sso_config(text)
    TO librehr_app;
  END IF;
END $$;
