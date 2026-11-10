-- 0029_auditor_access_expiry.sql
-- TIM-008: the read-only inspector/auditor role gets time-boxed access.
--
-- An auditor membership carries an access end date (access_expires_at). The
-- membership lookup refuses it once that instant has passed, so expiry needs
-- no background job: sessions, personal access tokens, new sign-ins and
-- session binding all resolve memberships through librehr_auth_membership
-- (0019/0021) and stop working at the same moment. Other roles keep NULL,
-- which means "no access end date".
--
-- Invitations carry the end date chosen when the auditor is invited
-- (invitations.access_expires_at); accepting copies it to the membership.
-- This is unrelated to invitations.expires_at, the 7-day link expiry.
--
-- organizations.auditor_access_max_days caps how far ahead an end date may be
-- set (default 90 days, configurable 1..366 per organization). The API
-- enforces the cap when inviting or extending; the database only stores it.
--
-- Backfill: auditors that existed before this release had unlimited access.
-- They get 90 days from the upgrade (the default cap), so nobody loses access
-- at upgrade time and every auditor has an end date afterwards. Admins can
-- extend or revoke in Settings -> Inspector access. See
-- docs/guides/upgrading.md.
--
-- librehr_auth_membership is replaced with the 0021 body plus the expiry
-- condition; its signature, SECURITY DEFINER, search_path and privileges are
-- unchanged (CREATE OR REPLACE keeps the existing grants and revokes).

-- 1. Columns. Additive and nullable (or defaulted), safe on populated tables.
ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "access_expires_at" timestamptz NULL;
ALTER TABLE "invitations"
  ADD COLUMN IF NOT EXISTS "access_expires_at" timestamptz NULL;
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "auditor_access_max_days" integer NOT NULL DEFAULT 90
  CONSTRAINT "organizations_auditor_access_max_days_check"
  CHECK ("auditor_access_max_days" BETWEEN 1 AND 366);

COMMENT ON COLUMN "memberships"."access_expires_at" IS
  'TIM-008: instant at which this membership stops granting access (auditors); NULL means no end.';
COMMENT ON COLUMN "invitations"."access_expires_at" IS
  'TIM-008: access end date copied to the membership on acceptance (auditors only).';
COMMENT ON COLUMN "organizations"."auditor_access_max_days" IS
  'TIM-008: maximum number of days ahead an auditor access end date may be set.';

-- 2. Backfill existing auditors. memberships is under FORCE ROW LEVEL
-- SECURITY (0001), which binds the owner role too, so a plain UPDATE would
-- see no rows. The owner lifts FORCE for this one statement and restores it
-- in the same transaction (the runner wraps each migration in one), the same
-- way as 0026_hash_bearer_tokens.sql.
-- Auditor invitations created before this release get the same 90 days, so
-- accepting one later still yields an auditor membership with an end date.
-- Both ALTERs take an ACCESS EXCLUSIVE lock until the migration commits,
-- which also pauses sign-in and session lookups for that moment.
ALTER TABLE "memberships" NO FORCE ROW LEVEL SECURITY;
UPDATE "memberships"
SET "access_expires_at" = now() + interval '90 days'
WHERE "role" = 'auditor' AND "access_expires_at" IS NULL;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;

ALTER TABLE "invitations" NO FORCE ROW LEVEL SECURITY;
UPDATE "invitations"
SET "access_expires_at" = now() + interval '90 days'
WHERE "role" = 'auditor' AND "access_expires_at" IS NULL;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;

-- 2b. The invariant, enforced by the database: an auditor membership (or
-- auditor invitation) always has an access end date. Every API path that
-- writes memberships sets or clears the column with the role. Dropped first
-- so the file can be re-applied by tests.
ALTER TABLE "memberships"
  DROP CONSTRAINT IF EXISTS "memberships_auditor_access_expiry_check";
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_auditor_access_expiry_check"
  CHECK ("role" <> 'auditor' OR "access_expires_at" IS NOT NULL);
ALTER TABLE "invitations"
  DROP CONSTRAINT IF EXISTS "invitations_auditor_access_expiry_check";
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_auditor_access_expiry_check"
  CHECK ("role" <> 'auditor' OR "access_expires_at" IS NOT NULL);

-- 3. The membership lookup also skips memberships whose access has ended.
-- Body copied from 0021_terminated_access.sql; only the expiry line is new.
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
    ORDER BY m.created_at, m.id
    LIMIT 1;
  PERFORM set_config('librehr.identity_lookup', coalesce(previous, ''), true);
END
$$;

-- 4. Privileges, restated as in 0021 so the outcome does not depend on
-- CREATE OR REPLACE preserving them: the runtime role never calls the
-- membership lookup directly.
REVOKE ALL ON FUNCTION librehr_auth_membership(uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    REVOKE EXECUTE ON FUNCTION librehr_auth_membership(uuid, uuid) FROM librehr_app;
  END IF;
END $$;
