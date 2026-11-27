-- 0047_secondary_lead_visibility.sql
-- ORG-007 (issue #81, ADR 0008 decision 8): how much the lead of a
-- department, project or area sees of its members beyond their own role.
--
--   off      nothing beyond the role's permissions;
--   calendar members' absences masked as "Away" (the team calendar already
--            shows this to everyone, so it adds no exposure);
--   profile  also the members' profiles, limited to directory fields.
--
-- No value grants write, approval or sensitive-field access; the API applies
-- it as an allow-list of read permissions. A lead is the lead_employee_id of
-- a department or org group, never a membership role label.
--
-- Additive: a defaulted NOT NULL column with a CHECK. Existing organizations
-- get the default 'calendar', which changes nothing they can see today.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "secondary_lead_visibility" text NOT NULL
  DEFAULT 'calendar';

-- Dropped first so the file can be re-applied by tests.
ALTER TABLE "organizations"
  DROP CONSTRAINT IF EXISTS "organizations_secondary_lead_visibility_check";
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_secondary_lead_visibility_check"
  CHECK ("secondary_lead_visibility" IN ('off', 'calendar', 'profile'));

COMMENT ON COLUMN "organizations"."secondary_lead_visibility" IS
  'ORG-007: read access of department and group leads to their members: off, calendar or profile.';
