-- 0044_sso_login.sql
-- AUTH-004 (Business edition, issue #34): storage for the OIDC sign-in flow.
--
-- 1. sso_login_requests: one row per started sign-in (POST /v1/sso/authorize).
--    It keeps the PKCE code_verifier and the nonce between the redirect to the
--    identity provider and the callback, so any API replica can finish the
--    flow. The browser only holds `state` (a 32-byte random value, also set in
--    an HttpOnly cookie by the API); only its SHA-256 hex (hashBearerToken) is
--    stored. A request is valid for 10 minutes and can be consumed once.
--    Like sessions and password_reset_tokens (0040) it is a global table
--    without RLS: the callback runs before any tenant context exists. The
--    runtime role may create and purge rows but not update them, so a
--    consumed request can never be made usable again; consuming goes through
--    librehr_auth_sso_consume.
--
-- 2. sso_identities: the link between an identity provider account
--    (issuer + `sub`) and a member of the organization. The first sign-in
--    links by verified email; later ones match on `sub`, so an email that the
--    provider renames or reassigns cannot take over another account. A user
--    has at most one subject per issuer and organization. The link references
--    the membership, so removing a member removes the link. Tenant table:
--    RLS forced, ordinary tenant_isolation_policy. The runtime role can read
--    and delete links in its organization; only librehr_auth_sso_resolve_user
--    creates them.
--
-- 3. librehr_auth_sso_consume and librehr_auth_sso_resolve_user, SECURITY
--    DEFINER functions modelled on 0019/0040: keyed on the state hash (the
--    secret the caller holds), never on a bare user id; search_path pinned and
--    every name schema-qualified; settings restored before returning; EXECUTE
--    for librehr_app only. No RLS is disabled and no lookup policy is added:
--    sso_configurations is read through its existing owner-only lookup policy
--    (0019/0020), memberships through librehr_auth_membership (which keeps the
--    EMP-007 termination and TIM-008 auditor expiry rules), and sso_identities
--    under its tenant policy by setting app.current_org to the request's
--    organization.
--
-- No just-in-time provisioning: a person must already be a member (invited
-- through AUTH-005) to sign in with SSO.
--
-- Cross-tenant safety. users (and so passwords and second factors) is global,
-- while each organization controls its own identity provider. An SSO sign-in
-- is therefore refused for a person who is also an active member of another
-- organization: otherwise the admin of one organization could assert that
-- person's email at their own provider, get a session and change the
-- person's global credentials, locking them out of the other organization.
-- Such people keep signing in with their password until a step-up policy
-- exists. For the same reason librehr_auth_sso_domains_taken lets the API
-- refuse an allow-list that claims a domain another organization's enabled
-- configuration already claims (authorize resolves a domain to one
-- organization only).
--
-- Retention: login requests are purged by the API one day after creation,
-- whenever a new sign-in starts (they hold no personal data: ids, the issuer,
-- the client id and single-use secrets). Identity links live as long as the
-- membership and go with it, the user or the organization (cascade).
--
-- Rollback: purely additive. To revert, drop the functions
-- librehr_auth_sso_domains_taken(uuid, jsonb),
-- librehr_auth_sso_resolve_user(text, text, text, text),
-- librehr_auth_sso_other_org_member(uuid, uuid) and
-- librehr_auth_sso_consume(text), then the tables sso_identities and
-- sso_login_requests; no existing data changes.

-- 1. Login requests.
CREATE TABLE IF NOT EXISTS "sso_login_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "state_hash" text NOT NULL UNIQUE,
  "organization_id" uuid NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "sso_configuration_id" uuid NOT NULL
    REFERENCES "sso_configurations"("id") ON DELETE CASCADE,
  -- Snapshot of the configuration the flow started with; the callback is
  -- refused if the configuration changed meanwhile.
  "issuer_url" text NOT NULL,
  "client_id" text NOT NULL,
  "nonce" text NOT NULL,
  "code_verifier" text NOT NULL,
  "locale" text NOT NULL DEFAULT 'ca',
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sso_login_requests_locale_check"
    CHECK ("locale" IN ('ca', 'es', 'en'))
);

CREATE INDEX IF NOT EXISTS "sso_login_requests_created_idx"
  ON "sso_login_requests" ("created_at");
CREATE INDEX IF NOT EXISTS "sso_login_requests_config_idx"
  ON "sso_login_requests" ("sso_configuration_id");

-- 2. Identity links.
CREATE TABLE IF NOT EXISTS "sso_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  "user_id" uuid NOT NULL,
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_login_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sso_identities_membership_fk"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "memberships" ("organization_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "sso_identities_subject_unique"
    UNIQUE ("organization_id", "issuer", "subject"),
  CONSTRAINT "sso_identities_user_unique"
    UNIQUE ("organization_id", "issuer", "user_id")
);

ALTER TABLE "sso_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_identities" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "sso_identities";
CREATE POLICY "tenant_isolation_policy" ON "sso_identities"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Default privileges (0015) grant full DML on new tables; narrow them.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, DELETE ON "sso_login_requests" TO %I',
        runtime_role
      );
      EXECUTE format(
        'REVOKE UPDATE, TRUNCATE ON "sso_login_requests" FROM %I',
        runtime_role
      );
      EXECUTE format(
        'GRANT SELECT, DELETE ON "sso_identities" TO %I',
        runtime_role
      );
      EXECUTE format(
        'REVOKE INSERT, UPDATE, TRUNCATE ON "sso_identities" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

-- 3a. Consumes a login request: marks it used and returns what the callback
-- needs to exchange the code. Single use: the UPDATE only matches an unused
-- row, so a concurrent second call waits for the first and then finds none.
-- Outcomes:
--   ok          - every column is set (client_secret as stored: an envelope);
--   expired     - the request was past expires_at (still spent);
--   unavailable - the configuration was disabled, deleted or changed since
--                 the flow started (still spent);
--   invalid     - unknown or already used state; nothing else is returned.
-- organization_id and locale are returned with expired and unavailable so the
-- API can audit the failure and answer in the person's language.
CREATE OR REPLACE FUNCTION librehr_auth_sso_consume(p_state_hash text)
RETURNS TABLE (
  outcome text,
  organization_id uuid,
  sso_configuration_id uuid,
  provider text,
  issuer_url text,
  client_id text,
  client_secret text,
  allowed_domains jsonb,
  nonce text,
  code_verifier text,
  locale text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous_lookup text := current_setting('librehr.identity_lookup', true);
  v_req public.sso_login_requests%ROWTYPE;
  v_config public.sso_configurations%ROWTYPE;
BEGIN
  IF p_state_hash IS NULL OR length(p_state_hash) = 0 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::text,
      NULL::text;
    RETURN;
  END IF;

  UPDATE public.sso_login_requests r
  SET consumed_at = now()
  WHERE r.state_hash = p_state_hash AND r.consumed_at IS NULL
  RETURNING r.* INTO v_req;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::text,
      NULL::text;
    RETURN;
  END IF;

  IF v_req.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, v_req.organization_id, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
      NULL::text, v_req.locale;
    RETURN;
  END IF;

  PERFORM set_config('librehr.identity_lookup', 'on', true);
  SELECT c.* INTO v_config
  FROM public.sso_configurations c
  WHERE c.id = v_req.sso_configuration_id
    AND c.organization_id = v_req.organization_id
    AND c.enabled
    AND c.issuer_url = v_req.issuer_url
    AND c.client_id = v_req.client_id;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous_lookup, ''), true);

  IF v_config.id IS NULL THEN
    RETURN QUERY SELECT 'unavailable'::text, v_req.organization_id, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
      NULL::text, v_req.locale;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_req.organization_id, v_config.id,
    v_config.provider, v_config.issuer_url, v_config.client_id,
    v_config.client_secret, v_config.allowed_domains, v_req.nonce,
    v_req.code_verifier, v_req.locale;
END
$$;

-- 3b-helper. Whether p_user_id is an active member of an organization other
-- than p_organization_id. Active follows librehr_auth_membership (0021/0029):
-- auditor access not expired, not a terminated employee whose termination
-- date has arrived. Internal to librehr_auth_sso_resolve_user (no grant).
CREATE OR REPLACE FUNCTION librehr_auth_sso_other_org_member(
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_lookup text := current_setting('librehr.identity_lookup', true);
  v_found boolean;
BEGIN
  PERFORM set_config('librehr.identity_lookup', 'on', true);
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id
      AND m.organization_id <> p_organization_id
      AND (m.access_expires_at IS NULL OR m.access_expires_at > now())
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
  ) INTO v_found;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous_lookup, ''), true);
  RETURN v_found;
END
$$;

-- 3b. Maps a verified identity to a member of the request's organization and
-- links it. Callable once per consumed request, within 10 minutes of
-- consuming it; the request is spent whatever the outcome. The API calls it
-- only after verifying the id_token (signature, issuer, audience, nonce) and
-- that the email is verified. Outcomes, with user_id set only for ok:
--   ok                 - linked (first sign-in) or matched by subject;
--   expired            - unknown, unconsumed, already completed or too old;
--   invalid            - missing values, or an issuer other than the request's;
--   unavailable        - the configuration was disabled or changed meanwhile;
--   domain_not_allowed - the email's domain is not in allowed_domains;
--   no_account         - no active member (EMP-007 termination and auditor
--                        expiry included) with that subject or email;
--   identity_conflict  - the member is already linked to another subject of
--                        this issuer, or the subject to another member;
--   multi_org_account  - the person is also an active member of another
--                        organization (see the header: global credentials).
-- organization_id is returned with every outcome except expired and invalid
-- so the API can audit refusals.
CREATE OR REPLACE FUNCTION librehr_auth_sso_resolve_user(
  p_state_hash text,
  p_issuer text,
  p_subject text,
  p_email text
)
RETURNS TABLE (outcome text, user_id uuid, organization_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous_lookup text := current_setting('librehr.identity_lookup', true);
  previous_org text := current_setting('app.current_org', true);
  v_req public.sso_login_requests%ROWTYPE;
  v_domains jsonb;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_domain text;
  v_user uuid;
  v_linked uuid;
  v_outcome text;
BEGIN
  SELECT r.* INTO v_req
  FROM public.sso_login_requests r
  WHERE r.state_hash = p_state_hash
    AND r.consumed_at IS NOT NULL
    AND r.completed_at IS NULL
    AND r.consumed_at > now() - interval '10 minutes'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  UPDATE public.sso_login_requests SET completed_at = now()
  WHERE id = v_req.id;

  v_domain := substring(v_email FROM '^[^@]+@([^@]+)$');
  IF p_issuer IS DISTINCT FROM v_req.issuer_url
     OR p_subject IS NULL OR length(p_subject) = 0
     OR v_domain IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  PERFORM set_config('librehr.identity_lookup', 'on', true);
  SELECT c.allowed_domains INTO v_domains
  FROM public.sso_configurations c
  WHERE c.id = v_req.sso_configuration_id
    AND c.organization_id = v_req.organization_id
    AND c.enabled
    AND c.issuer_url = v_req.issuer_url
    AND c.client_id = v_req.client_id;
  IF NOT FOUND THEN
    v_outcome := 'unavailable';
  END IF;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous_lookup, ''), true);

  -- Same normalization as librehr_auth_sso_config (0019).
  IF v_outcome IS NULL AND (
    jsonb_typeof(v_domains) IS DISTINCT FROM 'array' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_domains) AS d(domain)
      WHERE regexp_replace(lower(btrim(d.domain)), '^@', '') = v_domain
    )
  ) THEN
    v_outcome := 'domain_not_allowed';
  END IF;
  IF v_outcome IS NOT NULL THEN
    RETURN QUERY SELECT v_outcome, NULL::uuid, v_req.organization_id;
    RETURN;
  END IF;

  PERFORM set_config('app.current_org', v_req.organization_id::text, true);

  SELECT i.user_id INTO v_linked
  FROM public.sso_identities i
  WHERE i.organization_id = v_req.organization_id
    AND i.issuer = v_req.issuer_url
    AND i.subject = p_subject;

  IF v_linked IS NOT NULL THEN
    v_user := v_linked;
  ELSE
    -- Exact match first (users.email is unique); a case-insensitive match
    -- only when it is unambiguous.
    SELECT u.id INTO v_user FROM public.users u WHERE u.email = btrim(p_email);
    IF v_user IS NULL THEN
      SELECT min(u.id::text)::uuid INTO v_user
      FROM public.users u
      WHERE lower(u.email) = v_email
      HAVING count(*) = 1;
    END IF;
  END IF;

  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.librehr_auth_membership(v_user, v_req.organization_id)
  ) THEN
    v_outcome := 'no_account';
  ELSIF public.librehr_auth_sso_other_org_member(v_user, v_req.organization_id) THEN
    -- Applies to the subject match too: an existing link does not make the
    -- other organization's credentials any safer.
    v_outcome := 'multi_org_account';
  ELSIF v_linked IS NOT NULL THEN
    UPDATE public.sso_identities SET last_login_at = now()
    WHERE organization_id = v_req.organization_id
      AND issuer = v_req.issuer_url
      AND subject = p_subject;
    v_outcome := 'ok';
  ELSIF EXISTS (
    SELECT 1 FROM public.sso_identities i
    WHERE i.organization_id = v_req.organization_id
      AND i.issuer = v_req.issuer_url
      AND i.user_id = v_user
  ) THEN
    v_outcome := 'identity_conflict';
  ELSE
    -- A concurrent first sign-in may have linked meanwhile: no error, the
    -- outcome follows whichever link now exists.
    INSERT INTO public.sso_identities
      (organization_id, user_id, issuer, subject)
    VALUES (v_req.organization_id, v_user, v_req.issuer_url, p_subject)
    ON CONFLICT DO NOTHING;
    SELECT i.user_id INTO v_linked
    FROM public.sso_identities i
    WHERE i.organization_id = v_req.organization_id
      AND i.issuer = v_req.issuer_url
      AND i.subject = p_subject;
    v_outcome := CASE WHEN v_linked = v_user THEN 'ok' ELSE 'identity_conflict' END;
  END IF;

  PERFORM set_config('app.current_org', coalesce(previous_org, ''), true);

  IF v_outcome = 'ok' THEN
    RETURN QUERY SELECT v_outcome, v_user, v_req.organization_id;
  ELSE
    RETURN QUERY SELECT v_outcome, NULL::uuid, v_req.organization_id;
  END IF;
END
$$;

-- 3c. The domains of p_domains (normalized like librehr_auth_sso_config:
-- trimmed, lower case, without a leading '@') that an enabled configuration
-- of another organization already allows. POST /v1/sso/config refuses to
-- enable an allow-list that overlaps, so a tenant cannot send another
-- tenant's people to its own identity provider. Returns domain names only,
-- never which organization claims them.
CREATE OR REPLACE FUNCTION librehr_auth_sso_domains_taken(
  p_organization_id uuid,
  p_domains jsonb
)
RETURNS TABLE (domain text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous text := current_setting('librehr.identity_lookup', true);
BEGIN
  IF p_organization_id IS NULL OR jsonb_typeof(p_domains) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;
  PERFORM set_config('librehr.identity_lookup', 'on', true);
  RETURN QUERY
    SELECT DISTINCT wanted.domain
    FROM (
      SELECT regexp_replace(lower(btrim(d.value)), '^@', '') AS domain
      FROM jsonb_array_elements_text(p_domains) AS d(value)
    ) AS wanted
    WHERE length(wanted.domain) > 0
      AND EXISTS (
        SELECT 1
        FROM public.sso_configurations c
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(c.allowed_domains) = 'array'
               THEN c.allowed_domains ELSE '[]'::jsonb END
        ) AS claimed(value)
        WHERE c.enabled
          AND c.organization_id <> p_organization_id
          AND regexp_replace(lower(btrim(claimed.value)), '^@', '') = wanted.domain
      )
    ORDER BY wanted.domain;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- 4. Only the runtime role may call them; the helper is internal.
REVOKE ALL ON FUNCTION librehr_auth_sso_consume(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_sso_resolve_user(text, text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_sso_other_org_member(uuid, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION librehr_auth_sso_domains_taken(uuid, jsonb)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    GRANT EXECUTE ON FUNCTION
      librehr_auth_sso_consume(text),
      librehr_auth_sso_resolve_user(text, text, text, text),
      librehr_auth_sso_domains_taken(uuid, jsonb)
    TO librehr_app;
  END IF;
END $$;

COMMENT ON TABLE "sso_login_requests" IS
  'AUTH-004: single-use OIDC sign-in requests; state_hash is the SHA-256 of the state value.';
COMMENT ON TABLE "sso_identities" IS
  'AUTH-004: links an identity provider subject (issuer, sub) to a member of the organization.';
