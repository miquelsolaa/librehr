-- 0025c_two_factor_replay.sql
-- AUTH-003: second-factor codes are single use.
--
-- 1. two_factor_last_step is the newest accepted TOTP time step (30 s
--    counter). A code is accepted only for a later step, in one conditional
--    UPDATE, so the same code cannot be replayed within its validity window,
--    not even by two parallel requests.
-- 2. Recovery codes are burned with a single conditional UPDATE that removes
--    the hash from the jsonb array, which needs the column to hold an array.
--    Older code wrote it as a JSON-encoded string inside jsonb; those values
--    are rewritten as the array they encode. users carries no RLS and no
--    append-only trigger, so this one-off normalisation is a plain UPDATE.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_last_step" bigint;

UPDATE "users"
SET "two_factor_recovery_codes" = ("two_factor_recovery_codes" #>> '{}')::jsonb
WHERE jsonb_typeof("two_factor_recovery_codes") = 'string'
  AND ("two_factor_recovery_codes" #>> '{}') LIKE '[%';
