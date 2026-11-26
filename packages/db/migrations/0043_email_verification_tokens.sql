-- 0043_email_verification_tokens.sql
-- AUTH-001: email verification.
--
-- A verification link carries a random token; only its SHA-256 hex
-- (hashBearerToken) is stored, as for sessions, invitations and reset links.
-- A token is valid for 24 hours by default (the API sets expires_at) and
-- only while used_at is NULL. Requesting a new link marks the user's earlier
-- unused links as used, so at most one works.
--
-- Each row stores the address the link was sent to. A token verifies the
-- account only while users.email still equals that address, so a link can
-- never confirm an address it was not sent to (for example after a future
-- change of login email).
--
-- users and sessions are global tables without RLS (0019), and so is this
-- one: a link is confirmed without a session, before any tenant context
-- exists.
--
-- Retention: rows older than 30 days (all spent or expired) are deleted by
-- the API whenever a new link is requested, as for password_reset_tokens
-- (0040). ADM-005 retention enforcement is not implemented yet; once it is,
-- it should purge this table too. The email column is personal data.
--
-- Existing users.email_verified values are not changed.
--
-- Rollback: purely additive. To revert, drop the function
-- librehr_auth_verify_email(text) and the table email_verification_tokens;
-- no existing data changes.

CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_verification_tokens_user_idx"
  ON "email_verification_tokens" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_created_idx"
  ON "email_verification_tokens" ("created_at");

-- The runtime roles create and read tokens, spend earlier ones when a new
-- link is requested, and delete rows past the 30-day retention.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON "email_verification_tokens" TO %I',
        runtime_role
      );
      EXECUTE format(
        'REVOKE TRUNCATE ON "email_verification_tokens" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

-- Spends a verification token and marks the account's email as verified in
-- one transaction, with an audit entry (ids only) in each organization the
-- user belongs to. Returns the user id, or NULL when the token is unknown,
-- used or expired, or was sent to an address that is no longer the
-- account's email.
--
-- It is keyed on the secret the caller holds (the token hash), like the
-- functions of 0019 and 0040, never on a bare user id: 0021 withdrew such
-- lookups from the runtime role because they map users to organizations
-- across tenants. memberships are read through the owner-only
-- identity_lookup policy (0019); audit_log rows are written under their
-- tenant policy by setting app.current_org to each organization in turn.
-- The previous settings are restored before returning.
--
-- Locks the users row before the token row, the same order as a new link
-- request, so a request and a confirmation for one user cannot deadlock. A
-- second confirmation with the same token waits for the first and then no
-- longer matches `used_at IS NULL`.
CREATE OR REPLACE FUNCTION librehr_auth_verify_email(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid;
  v_email text;
  v_org uuid;
  previous_lookup text := current_setting('librehr.identity_lookup', true);
  previous_org text := current_setting('app.current_org', true);
  previous_user text := current_setting('app.current_user', true);
BEGIN
  IF p_token_hash IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.user_id INTO v_user
  FROM public.email_verification_tokens t
  WHERE t.token_hash = p_token_hash;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.email INTO v_email FROM public.users u
  WHERE u.id = v_user
  FOR UPDATE;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.email_verification_tokens t
  WHERE t.token_hash = p_token_hash
    AND t.used_at IS NULL
    AND t.expires_at > now()
    AND t.email = v_email
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.email_verification_tokens SET used_at = now()
  WHERE user_id = v_user AND used_at IS NULL;
  UPDATE public.users
  SET email_verified = true, updated_at = now()
  WHERE id = v_user;

  PERFORM set_config('librehr.identity_lookup', 'on', true);
  PERFORM set_config('app.current_user', v_user::text, true);
  FOR v_org IN
    SELECT m.organization_id FROM public.memberships m
    WHERE m.user_id = v_user
    ORDER BY 1
  LOOP
    PERFORM set_config('app.current_org', v_org::text, true);
    INSERT INTO public.audit_log
      (organization_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_org, v_user, 'auth.email_verified', 'user', v_user,
      '{}'::jsonb);
  END LOOP;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous_lookup, ''), true);
  PERFORM set_config('app.current_org', coalesce(previous_org, ''), true);
  PERFORM set_config('app.current_user', coalesce(previous_user, ''), true);

  RETURN v_user;
END
$$;

-- Granted to librehr_app only, like the identity functions of 0019.
REVOKE ALL ON FUNCTION librehr_auth_verify_email(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    GRANT EXECUTE ON FUNCTION librehr_auth_verify_email(text)
      TO librehr_app;
  END IF;
END $$;

COMMENT ON TABLE "email_verification_tokens" IS
  'AUTH-001: single-use email verification links; token_hash is the SHA-256 of the emailed token, email the address it was sent to.';
