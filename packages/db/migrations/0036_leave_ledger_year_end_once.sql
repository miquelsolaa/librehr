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
-- Losing days is off by default (maintainer decision on #132):
--
-- * leave_policies.carryover_enforced (boolean, NOT NULL, DEFAULT false).
--   While false, the year close carries the whole positive balance over and
--   never writes forfeit or expiry entries; carryover_max_days and
--   carryover_expiry_months only take effect once an admin sets it to true.
--   Existing policies get false, so no installation starts losing days on
--   upgrade. A constant default makes ADD COLUMN a catalog-only change
--   (PostgreSQL 11+): no table rewrite.
-- * leave_ledger.expires_on (date, nullable): set only on the +carried
--   carryover entry of an enforced close, to the last day those days can be
--   used, computed from the policy as it stood at the close. The expiry run
--   reads it instead of the policy's current settings, so editing the policy
--   later never moves an expiry that was already announced, and an
--   unenforced close (NULL) never expires. Nullable with no default: a
--   catalog-only change, existing rows stay NULL. Rows are never updated
--   (append-only); the column is written once, on insert.
--
-- New entry type 'forfeit': leave_ledger.entry_type is a text column with no
-- enum type or CHECK constraint (0000), so no type change is needed; the
-- column comment below documents the values in use.
--
-- Additive only: two columns, one index and comments. No constraint, policy
-- or grant changes (librehr_app's table-level grants cover new columns); RLS
-- is untouched. Safe on a populated database because no
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
-- Rollback note: roll the worker and API back first, then
-- DROP INDEX leave_ledger_year_end_once; (re-enables duplicate year-end
-- entries on retried jobs), ALTER TABLE leave_ledger DROP COLUMN expires_on;
-- and ALTER TABLE leave_policies DROP COLUMN carryover_enforced;.

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS carryover_enforced boolean NOT NULL DEFAULT false;

ALTER TABLE leave_ledger ADD COLUMN IF NOT EXISTS expires_on date;

COMMENT ON COLUMN leave_policies.carryover_enforced IS
  'LEA-002: when true, the year-end close caps carry-over at carryover_max_days, forfeits the rest and expires carried days after carryover_expiry_months, except for employees with leave protected by ET art. 38.3. False (default): the whole balance is carried over and nothing is lost.';

COMMENT ON COLUMN leave_ledger.expires_on IS
  'LEA-002: on the +carried carryover entry of an enforced year-end close, the last day those days can be used. NULL: never expires.';

CREATE UNIQUE INDEX IF NOT EXISTS leave_ledger_year_end_once
  ON leave_ledger (organization_id, employee_id, source_ref)
  WHERE entry_type IN ('carryover', 'forfeit', 'expiry');

COMMENT ON COLUMN leave_ledger.entry_type IS
  'accrual, usage, adjustment, reversal, carryover, forfeit or expiry (LEA-002, LEA-005). Automatic accrual, carryover, forfeit and expiry entries are unique per employee and source_ref (indexes leave_ledger_accrual_once, leave_ledger_year_end_once).';
