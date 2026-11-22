-- 0036_leave_ledger_year_end_once.sql
-- LEA-002 (issue #116): year-end carry-over, forfeit and carry-over expiry.
--
-- The leave.accrue job now closes each leave year per employee and leave
-- type, and later expires carried-over days that were not used in time. It
-- writes these entries, all with a leave_type_id:
--
--   entry_type  source_ref                              amount
--   carryover   carryover:<leaveTypeId>:<YYYY>:close     -carried (31 Dec)
--   carryover   carryover:<leaveTypeId>:<YYYY>           +carried (1 Jan)
--   forfeit     forfeit:<leaveTypeId>:<YYYY>             -excess over the cap
--   expiry      expiry:<leaveTypeId>:<YYYY>              -carried days unused
--
-- pg-boss delivers jobs at least once, so the handler inserts with
-- ON CONFLICT DO NOTHING against this index: re-running a year never closes
-- or expires it twice. It mirrors leave_ledger_accrual_once (0030).
--
-- New entry type 'forfeit': leave_ledger.entry_type is a text column with no
-- enum type or CHECK constraint (0000), so no type change is needed; the
-- column comment below documents the values in use.
--
-- Additive only: one index and one comment. No column, constraint, policy or
-- grant changes; RLS is untouched. Safe on a populated database because no
-- earlier release wrote carryover, forfeit or expiry entries with a
-- source_ref (the API only books 'adjustment'; the dev seed's carryover row
-- has none, and NULL never conflicts), so no existing rows can collide.
-- Partial, so accrual, usage, adjustment and reversal rows are unaffected.
--
-- The runner wraps each migration in a transaction, so CREATE INDEX
-- CONCURRENTLY is not available: the build holds a SHARE lock on
-- leave_ledger, so reads continue but ledger writes wait until it finishes.
-- The scan is short on typical ledgers; on very large ones upgrade in a
-- quiet window.
--
-- Rollback note: DROP INDEX leave_ledger_year_end_once; (re-enables
-- duplicate year-end entries on retried jobs; roll the worker back first).

CREATE UNIQUE INDEX IF NOT EXISTS leave_ledger_year_end_once
  ON leave_ledger (organization_id, employee_id, source_ref)
  WHERE entry_type IN ('carryover', 'forfeit', 'expiry');

COMMENT ON COLUMN leave_ledger.entry_type IS
  'accrual, usage, adjustment, reversal, carryover, forfeit or expiry (LEA-002, LEA-005). Automatic accrual, carryover, forfeit and expiry entries are unique per employee and source_ref (indexes leave_ledger_accrual_once, leave_ledger_year_end_once).';
