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
-- Values that are not a plain decimal number in (0, 40] abort the migration
-- instead of being replaced. Contract hours are part of an employment
-- record and drive accrual, so silently writing 40.00 would grant full-time
-- accrual to someone whose contract says otherwise, and nobody would notice.
-- The error may quote the offending hours value; it never names a row, an
-- employee or an organization. The HINT gives the query that lists the bad
-- rows. The runner wraps each migration in a transaction, so a failed run
-- changes nothing.
--
-- No row is read through RLS: the conversion is the USING expression of
-- ALTER COLUMN TYPE and the range is a CHECK constraint, and neither a table
-- rewrite nor constraint validation is subject to row level security, so
-- FORCE ROW LEVEL SECURITY on employments stays on throughout. Everything is
-- inline (no helper function, so no TEMP privilege is needed).
--
-- Idempotent: the conversion only runs while the column is still text.
--
-- Locks: ALTER COLUMN TYPE rewrites employments under ACCESS EXCLUSIVE until
-- commit (one row per employment period, so quick). lock_timeout makes the
-- upgrade fail fast instead of queueing behind long transactions.
--
-- Rollback note: ALTER TABLE employments DROP CONSTRAINT
-- employments_working_hours_range, ALTER COLUMN working_hours_per_week
-- DROP DEFAULT, ALTER COLUMN working_hours_per_week TYPE text USING
-- working_hours_per_week::text, ALTER COLUMN working_hours_per_week
-- SET DEFAULT '40.0'; roll the code back first.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'employments'
      AND column_name = 'working_hours_per_week'
  ) <> 'text' THEN
    RETURN;
  END IF;

  BEGIN
    ALTER TABLE "employments"
      ALTER COLUMN "working_hours_per_week" DROP DEFAULT;
    -- A value that is not a plain decimal is cast with a prefix, so the
    -- cast fails and the error shows which value was refused.
    ALTER TABLE "employments"
      ALTER COLUMN "working_hours_per_week" TYPE numeric(5,2)
      USING CASE
        WHEN replace(btrim("working_hours_per_week"), ',', '.')
          ~ '^([0-9]{1,3}([.][0-9]*)?|[.][0-9]+)$'
        THEN round(replace(btrim("working_hours_per_week"), ',', '.')::numeric, 2)
        ELSE ('weekly hours ' || "working_hours_per_week")::numeric
      END;
    ALTER TABLE "employments"
      ALTER COLUMN "working_hours_per_week" SET DEFAULT 40.00;
    ALTER TABLE "employments"
      ADD CONSTRAINT "employments_working_hours_range"
      CHECK ("working_hours_per_week" > 0 AND "working_hours_per_week" <= 40);
  EXCEPTION
    WHEN invalid_text_representation OR check_violation THEN
      RAISE EXCEPTION
        '0037: weekly contract hours must be a number greater than 0 and at most 40 (%)', SQLERRM
        USING HINT = 'As a superuser, list the rows to correct from the employment contracts with: SELECT id, working_hours_per_week FROM employments WHERE CASE WHEN replace(btrim(working_hours_per_week), '','', ''.'') ~ ''^([0-9]{1,3}([.][0-9]*)?|[.][0-9]+)$'' THEN round(replace(btrim(working_hours_per_week), '','', ''.'')::numeric, 2) NOT BETWEEN 0.01 AND 40 ELSE true END; then run the migrations again.';
  END;
END $$;

COMMENT ON COLUMN "employments"."working_hours_per_week" IS
  'Weekly contract hours of this employment period (LEA-002), at most 40 (ET art. 34.1). A change of hours is a new period, so earlier periods keep their hours.';
