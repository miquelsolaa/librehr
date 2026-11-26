-- 0037_employment_weekly_hours_numeric.sql
-- LEA-002 (issue #131): weekly contract hours become a validated number.
--
-- employments.working_hours_per_week was free text (0002, default '40.0').
-- The leave.accrue job parses it for part-time proration (0034), and one
-- unparseable row (for example '37,5') made the job fail for the whole
-- organization. This migration converts the column to numeric(5,2) and adds
-- a range check, so such values can no longer be stored:
--
--   > 0 and <= 40: 40 h is the ordinary maximum week (ET art. 34.1), the
--   same cap as leave_policies.full_time_hours_per_week (0034).
--
-- Cast of existing values: surrounding blanks are trimmed and a decimal
-- comma becomes a point ('37,5' -> 37.50). More than two decimals are
-- rounded to two (numeric(5,2)), a difference under 0.005 h.
--
-- Values that cannot be read as a number in (0, 40] abort the migration
-- instead of being replaced. Contract hours are part of an employment
-- record and drive accrual, so silently writing 40.00 would grant full-time
-- accrual to someone whose contract says otherwise, and nobody would notice.
-- The error reports only the number of rows (no ids, names or values); the
-- HINT gives the query an administrator runs to find and fix them before
-- retrying the upgrade. The runner wraps each migration in a transaction, so
-- a failed run changes nothing.
--
-- employments is under FORCE ROW LEVEL SECURITY, which binds the owner too
-- (see 0026), so the pre-check would see no rows. FORCE is lifted for the
-- check and restored in the same transaction; no other session ever sees the
-- table without it. The ALTER itself is DDL and converts every row.
--
-- Idempotent: the conversion only runs while the column is still text.
--
-- Locks: ALTER COLUMN TYPE rewrites employments under ACCESS EXCLUSIVE until
-- commit. The table has one row per employment period, so this is quick.
--
-- Rollback note: ALTER TABLE employments DROP CONSTRAINT
-- employments_working_hours_range, ALTER COLUMN working_hours_per_week
-- DROP DEFAULT, ALTER COLUMN working_hours_per_week TYPE text USING
-- working_hours_per_week::text, ALTER COLUMN working_hours_per_week
-- SET DEFAULT '40.0'; roll the code back first.

-- Parses one stored text value; NULL when it is not a plain decimal number.
-- CASE (not AND) guarantees the cast never sees a non-numeric string.
CREATE OR REPLACE FUNCTION pg_temp.librehr_0037_hours(raw text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN replace(btrim(raw), ',', '.') ~ '^([0-9]{1,6}([.][0-9]*)?|[.][0-9]+)$'
    THEN round(replace(btrim(raw), ',', '.')::numeric, 2)
  END
$$;

ALTER TABLE "employments" NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  bad integer;
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'employments'
      AND column_name = 'working_hours_per_week'
  ) <> 'text' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO bad
  FROM "employments"
  WHERE COALESCE(
    pg_temp.librehr_0037_hours("working_hours_per_week") > 0
      AND pg_temp.librehr_0037_hours("working_hours_per_week") <= 40,
    false
  ) = false;

  IF bad > 0 THEN
    RAISE EXCEPTION
      '0037: % employment row(s) have weekly contract hours that are not a number greater than 0 and at most 40', bad
      USING HINT = 'As a superuser, list them with SELECT id, working_hours_per_week FROM employments ORDER BY id; correct each value from the employment contract (for example 37.5), then run the migrations again.';
  END IF;

  ALTER TABLE "employments"
    ALTER COLUMN "working_hours_per_week" DROP DEFAULT;
  ALTER TABLE "employments"
    ALTER COLUMN "working_hours_per_week" TYPE numeric(5,2)
    USING pg_temp.librehr_0037_hours("working_hours_per_week");
  ALTER TABLE "employments"
    ALTER COLUMN "working_hours_per_week" SET DEFAULT 40.00;
  ALTER TABLE "employments"
    ADD CONSTRAINT "employments_working_hours_range"
    CHECK ("working_hours_per_week" > 0 AND "working_hours_per_week" <= 40);
END $$;

ALTER TABLE "employments" FORCE ROW LEVEL SECURITY;

DROP FUNCTION pg_temp.librehr_0037_hours(text);

COMMENT ON COLUMN "employments"."working_hours_per_week" IS
  'Weekly contract hours of this employment period (LEA-002), at most 40 (ET art. 34.1). A change of hours is a new period, so earlier periods keep their hours.';
