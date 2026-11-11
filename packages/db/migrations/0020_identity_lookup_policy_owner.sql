-- 0020_identity_lookup_policy_owner.sql
-- AUTH-001/002, ORG-006, ADM-006: bind the identity-lookup policies to the
-- role that owns the lookup functions.
--
-- Migration 0019 created its four SELECT policies `TO CURRENT_USER`, i.e. the
-- role that happened to run it. The SECURITY DEFINER lookup functions run as
-- their *owner*, which on a correctly set up install is librehr_owner. If 0019
-- ran as another role (for example the bootstrap superuser) and the function
-- ownership was later moved to librehr_owner (docs/guides/upgrading.md), the
-- policies stayed on the old role and every sign-in, session and token lookup
-- found no rows.
--
-- Rebind them to librehr_owner when that role exists. On installs without it
-- (a single-role development database) they are left as they are. When 0019
-- already ran as librehr_owner this is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner') THEN
    ALTER POLICY "memberships_identity_lookup" ON "memberships"
      TO librehr_owner;
    ALTER POLICY "personal_access_tokens_identity_lookup" ON "personal_access_tokens"
      TO librehr_owner;
    ALTER POLICY "invitations_identity_lookup" ON "invitations"
      TO librehr_owner;
    ALTER POLICY "sso_configurations_identity_lookup" ON "sso_configurations"
      TO librehr_owner;
  END IF;
END $$;
