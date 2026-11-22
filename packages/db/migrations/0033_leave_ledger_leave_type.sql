-- 0033_leave_ledger_leave_type.sql
-- LEA-005 (issue #117): balances per leave type.
--
-- leave_ledger had no leave type, so an employee's vacation and personal-day
-- entries were summed into one balance. This migration:
--
-- 1. Adds a nullable leave_type_id. Nullable on purpose: entries written
--    before this release that cannot be attributed (manual adjustments,
--    hand-seeded rows) stay NULL and are reported as "unassigned"; see
--    docs/guides/leave-accrual.md for how balances treat them.
-- 2. Adds a composite foreign key (organization_id, leave_type_id) ->
--    leave_types (organization_id, id), so an entry can never point at
--    another tenant's leave type. That needs a unique index on
--    leave_types (organization_id, id); id is already the primary key, so
--    the index cannot fail on existing data. NO ACTION on delete: a leave
--    type with ledger history cannot be deleted (the ledger is append-only).
-- 3. Adds an index for per-type balance reads (employee, type, date order).
-- 4. Backfills the type of entries whose origin is recorded:
--    - usage and reversal entries: source_ref is the leave request id
--      (LeaveRepository.approveLeaveRequest / cancelLeaveRequest);
--    - accrual entries of the leave.accrue job: source_ref is
--      'accrual:<policyId>:<YYYY-MM>' and the policy has a leave type.
--    Matched within the same organization (and employee, for requests).
--    Only rows still NULL are touched, so re-running the file is a no-op.
--
-- The leave_ledger_accrual_once index of 0030 is unchanged and still right:
-- its key (organization, employee, source_ref) embeds the policy id, and a
-- policy has exactly one leave type, so "one accrual per policy and month"
-- is also "one per leave type, policy and month".
--
-- Append-only exception: leave_ledger refuses UPDATE (prevent_mod_leave_ledger
-- trigger, and privileges for the runtime role). The backfill only fills the
-- new column from data already recorded elsewhere; amount, entry_type,
-- dates, source_ref and note are never changed. The owner disables the
-- trigger for these statements and re-enables it in the same transaction
-- (the runner wraps each migration in one), so no other session ever sees
-- the table without it. The runtime role still has no UPDATE privilege.
--
-- The four tables involved are under FORCE ROW LEVEL SECURITY, which binds
-- the owner too (see 0026), so a plain UPDATE ... FROM would see no rows.
-- FORCE is lifted and restored inside the same transaction.
--
-- Locks: ALTER TABLE takes ACCESS EXCLUSIVE on leave_ledger, leave_requests,
-- leave_policies and leave_types until commit, so leave reads and writes wait
-- for the backfill. It is one pass over the ledger; on very large ledgers
-- upgrade in a quiet window.
--
-- Rollback note: ALTER TABLE leave_ledger DROP COLUMN leave_type_id; (drops
-- the FK and index with it) and DROP INDEX leave_types_org_id_uidx;. The API
-- of this release reads the column, so roll the code back first.

-- 1-3. Column, same-tenant foreign key and index.
ALTER TABLE "leave_ledger" ADD COLUMN IF NOT EXISTS "leave_type_id" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "leave_types_org_id_uidx"
  ON "leave_types" ("organization_id", "id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint
    WHERE conname = 'leave_ledger_leave_type_fk'
  ) THEN
    ALTER TABLE "leave_ledger"
      ADD CONSTRAINT "leave_ledger_leave_type_fk"
      FOREIGN KEY ("organization_id", "leave_type_id")
      REFERENCES "leave_types" ("organization_id", "id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "leave_ledger_employee_type_idx"
  ON "leave_ledger" ("organization_id", "employee_id", "leave_type_id", "effective_date");

-- 4. Backfill.
ALTER TABLE "leave_ledger" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_types" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger" DISABLE TRIGGER "prevent_mod_leave_ledger";

-- Usage and compensating reversals of a leave request. Compared as text so a
-- source_ref that is not a uuid can never make a cast fail.
UPDATE "leave_ledger" l
SET "leave_type_id" = r."leave_type_id"
FROM "leave_requests" r
WHERE l."leave_type_id" IS NULL
  AND l."entry_type" IN ('usage', 'reversal')
  AND l."source_ref" IS NOT NULL
  AND r."id"::text = l."source_ref"
  AND r."organization_id" = l."organization_id"
  AND r."employee_id" = l."employee_id";

-- Accruals of the leave.accrue job: 'accrual:<policyId>:<YYYY-MM>'.
UPDATE "leave_ledger" l
SET "leave_type_id" = p."leave_type_id"
FROM "leave_policies" p
WHERE l."leave_type_id" IS NULL
  AND l."entry_type" = 'accrual'
  AND l."source_ref" LIKE 'accrual:%:%'
  AND p."id"::text = split_part(l."source_ref", ':', 2)
  AND p."organization_id" = l."organization_id";

ALTER TABLE "leave_ledger" ENABLE TRIGGER "prevent_mod_leave_ledger";
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_policies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger" FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN "leave_ledger"."leave_type_id" IS
  'Leave type the entry counts toward (LEA-005). NULL only for entries written before 0033 whose origin was not recorded; reported as unassigned.';
