-- 0034_leave_policy_full_time_hours.sql
-- LEA-002 (issue #118): opt-in part-time proration of accrual, per policy.
--
-- The leave.accrue job uses a full-time-equivalent ratio of 1.0 for every
-- employee. That stays the default: Spanish statutory vacation is the same
-- number of days for part-time staff (ET art. 12.4.d), so vacation policies
-- must not be prorated. A policy that should be prorated (for example an
-- agreement-specific entitlement) sets the full-time week its collective
-- agreement defines; accrual then multiplies by
-- employments.working_hours_per_week / full_time_hours_per_week, capped at 1.
--
-- Capped at 40 h, the maximum ordinary full-time week (ET art. 34.1): a
-- contract on the default 40 h never has its accrual reduced.
--
-- Additive only: one nullable column with a range check. Existing policies
-- get NULL, which keeps today's behaviour (ratio 1.0), so it is safe on a
-- populated database and needs no backfill. ADD COLUMN without a default
-- does not rewrite the table, and every existing row passes the CHECK.
--
-- Rollback note: ALTER TABLE leave_policies DROP COLUMN
-- full_time_hours_per_week; (prorated policies then accrue at 1.0 again).

ALTER TABLE "leave_policies"
  ADD COLUMN IF NOT EXISTS "full_time_hours_per_week" numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint
    WHERE conname = 'leave_policies_full_time_hours_range'
      AND conrelid = 'leave_policies'::regclass
  ) THEN
    ALTER TABLE "leave_policies"
      ADD CONSTRAINT "leave_policies_full_time_hours_range"
      CHECK ("full_time_hours_per_week" IS NULL
             OR ("full_time_hours_per_week" > 0 AND "full_time_hours_per_week" <= 40));
  END IF;
END $$;

COMMENT ON COLUMN "leave_policies"."full_time_hours_per_week" IS
  'Full-time week of the collective agreement (LEA-002). NULL: no part-time proration (FTE 1.0, required for statutory vacation, ET art. 12.4.d).';
