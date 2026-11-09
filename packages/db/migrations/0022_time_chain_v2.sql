-- 0022_time_chain_v2.sql
-- TIM-002: versioned, keyed hash chain for time_events.
--
-- Existing rows keep hash_version = 1 (unkeyed SHA-256 over a payload whose
-- recorded_at did not match the stored column): they are reported as legacy
-- and unverifiable, never as verified or tampered. New rows are written with
-- hash_version = 2 (HMAC-SHA256 keyed by TIME_CHAIN_KEY) and a per-employee
-- sequence number that orders the chain independently of occurred_at.
--
-- Additive only. Adding a column with a constant default does not rewrite or
-- UPDATE existing rows, so the prevent_mod_time_events trigger (BEFORE UPDATE
-- OR DELETE) is not fired and stays in place; INSERTs of the new columns are
-- unaffected by it. No backfill: legacy rows keep seq NULL.

ALTER TABLE "time_events" ADD COLUMN IF NOT EXISTS "hash_version" smallint NOT NULL DEFAULT 1;
ALTER TABLE "time_events" ADD COLUMN IF NOT EXISTS "seq" bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'time_events_hash_version_check'
  ) THEN
    ALTER TABLE "time_events" ADD CONSTRAINT "time_events_hash_version_check"
      CHECK ("hash_version" IN (1, 2));
  END IF;
  -- A v2 row without a position in the chain could not be verified.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'time_events_v2_seq_check'
  ) THEN
    ALTER TABLE "time_events" ADD CONSTRAINT "time_events_v2_seq_check"
      CHECK ("hash_version" = 1 OR ("seq" IS NOT NULL AND "seq" >= 1));
  END IF;
END $$;

-- One position per employee chain: a concurrent writer that skipped the
-- advisory lock would fail here instead of forking the chain.
CREATE UNIQUE INDEX IF NOT EXISTS "time_events_chain_seq_uidx"
  ON "time_events" ("organization_id", "employee_id", "seq")
  WHERE "seq" IS NOT NULL;
