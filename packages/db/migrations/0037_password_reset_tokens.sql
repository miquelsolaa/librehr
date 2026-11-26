-- 0037_password_reset_tokens.sql
-- AUTH-001: self-service password reset.
--
-- A reset link carries a random token; only its SHA-256 hex
-- (hashBearerToken) is stored, as for sessions and invitations. A token is
-- valid for one hour and only while used_at is NULL. Requesting a new link
-- marks the user's earlier unused links as used, so at most one works.
--
-- users and sessions are global tables without RLS (0019), and so is this
-- one: a reset happens before any tenant context exists.
--
-- Retention: rows older than 30 days (all spent or expired) are deleted by
-- the API whenever a new link is requested. ADM-005 retention enforcement is
-- not implemented yet; once it is, it should purge this table too.
--
-- Rollback: purely additive. To revert, drop the function
-- librehr_auth_reset_password(text, text) and the table
-- password_reset_tokens; no existing data changes.

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx"
  ON "password_reset_tokens" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_created_idx"
  ON "password_reset_tokens" ("created_at");

-- The runtime roles create and read tokens, spend earlier ones when a new
-- link is requested, and delete rows past the 30-day retention.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON "password_reset_tokens" TO %I',
        runtime_role
      );
      EXECUTE format(
        'REVOKE TRUNCATE ON "password_reset_tokens" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

-- Spends a reset token and sets the new password in one transaction:
-- token check, password update, revocation of every session and personal
-- access token, and an audit entry (ids only, with the number of revoked
-- tokens) in each organization the user belongs to or holds a token in. Returns the
-- user id, or NULL when the token is unknown, used or expired, or the
-- account has no password (single sign-on only).
--
-- It is keyed on the secret the caller holds (the token hash), like the
-- functions of 0019, never on a bare user id: 0021 withdrew such lookups
-- from the runtime role because they map users to organizations across
-- tenants. memberships and personal_access_tokens are read through the
-- owner-only identity_lookup policies (0019); tokens are deleted and
-- audit_log rows written under their tenant policies by setting
-- app.current_org to each organization in turn.
--
-- Locks the users row before the token row, the same order as a new link
-- request, so a request and a confirmation for one user cannot deadlock. A
-- second confirmation with the same token waits for the first and then no
-- longer matches `used_at IS NULL`.
CREATE OR REPLACE FUNCTION librehr_auth_reset_password(
  p_token_hash text,
  p_password_hash text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_revoked integer;
  previous_lookup text := current_setting('librehr.identity_lookup', true);
  previous_org text := current_setting('app.current_org', true);
  previous_user text := current_setting('app.current_user', true);
BEGIN
  IF p_token_hash IS NULL OR p_password_hash IS NULL
     OR length(p_password_hash) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT t.user_id INTO v_user
  FROM public.password_reset_tokens t
  WHERE t.token_hash = p_token_hash;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.users u
  WHERE u.id = v_user AND u.password_hash IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.password_reset_tokens t
  WHERE t.token_hash = p_token_hash
    AND t.used_at IS NULL
    AND t.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.password_reset_tokens SET used_at = now()
  WHERE user_id = v_user AND used_at IS NULL;
  UPDATE public.users
  SET password_hash = p_password_hash, updated_at = now()
  WHERE id = v_user;
  DELETE FROM public.sessions WHERE user_id = v_user;

  PERFORM set_config('librehr.identity_lookup', 'on', true);
  PERFORM set_config('app.current_user', v_user::text, true);
  FOR v_org IN
    SELECT m.organization_id FROM public.memberships m
    WHERE m.user_id = v_user
    UNION
    SELECT pat.organization_id FROM public.personal_access_tokens pat
    WHERE pat.user_id = v_user
    ORDER BY 1
  LOOP
    PERFORM set_config('app.current_org', v_org::text, true);
    DELETE FROM public.personal_access_tokens
    WHERE user_id = v_user AND organization_id = v_org;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
    INSERT INTO public.audit_log
      (organization_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_org, v_user, 'auth.password_reset', 'user', v_user,
      jsonb_build_object('revokedTokens', v_revoked));
  END LOOP;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous_lookup, ''), true);
  PERFORM set_config('app.current_org', coalesce(previous_org, ''), true);
  PERFORM set_config('app.current_user', coalesce(previous_user, ''), true);

  RETURN v_user;
END
$$;

-- Granted to librehr_app only, like the identity functions of 0019.
REVOKE ALL ON FUNCTION librehr_auth_reset_password(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    GRANT EXECUTE ON FUNCTION librehr_auth_reset_password(text, text)
      TO librehr_app;
  END IF;
END $$;

COMMENT ON TABLE "password_reset_tokens" IS
  'AUTH-001: single-use password reset links; token_hash is the SHA-256 of the emailed token.';
