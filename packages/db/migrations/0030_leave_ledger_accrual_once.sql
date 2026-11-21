-- 0030_leave_ledger_accrual_once.sql
-- LEA-002: at most one accrual ledger entry per employee and source_ref.
--
-- The leave.accrue job writes one entry per policy and month with
-- source_ref = 'accrual:<policyId>:<YYYY-MM>'. pg-boss delivers jobs at least
-- once and does not dedupe a job enqueued again after completion, so the
-- handler inserts with ON CONFLICT DO NOTHING against this index: re-running
-- a month never accrues twice.
--
-- Additive only: no column, constraint, policy or grant changes. Safe on a
-- populated database because nothing wrote accrual entries before this
-- release, so no existing rows can collide. Partial (entry_type = 'accrual'),
-- so usage, adjustment and reversal rows are unaffected.
--
-- The runner wraps each migration in a transaction, so CREATE INDEX
-- CONCURRENTLY is not available: the build holds a SHARE lock on
-- leave_ledger, so reads continue but ledger writes (approvals,
-- cancellations, adjustments) wait until it finishes. The scan is short on
-- typical ledgers; on very large ones upgrade in a quiet window.
--
-- Rollback note: DROP INDEX leave_ledger_accrual_once; (re-enables duplicate
-- accruals on retried jobs).

CREATE UNIQUE INDEX IF NOT EXISTS leave_ledger_accrual_once
  ON leave_ledger (organization_id, employee_id, source_ref)
  WHERE entry_type = 'accrual';
