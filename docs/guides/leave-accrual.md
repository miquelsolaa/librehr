# Leave accrual (LEA-002)

The `leave.accrue` worker job turns leave policy assignments into `accrual`
entries in the append-only `leave_ledger`. Balances are derived from that
ledger (LEA-005); no balance column is ever updated.

## What a run does

A job carries `{ organizationId, runDate }`. `runDate` is a business date in
the organization's time zone, and the run accrues its calendar month. Every
number (annual allowance, accrual method) comes from `leave_policies`;
nothing is defaulted in code.

For each employee and policy that applies on some day of the year so far, the
run computes the entitlement due **from 1 January to the end of the month**
(the year-to-date target) and writes the difference from what the ledger
already holds for that policy and year:

| Method    | Year-to-date target                                                                 |
| --------- | ----------------------------------------------------------------------------------- |
| `upfront` | The whole year, prorated by the year's active days, from the first active month on. |
| `monthly` | Allowance / 12 per month, each month prorated by its active days.                   |
| `daily`   | Allowance × active days so far / days in the year (366 in leap years).              |

Active days are days covered by both an employment span (cut at the
termination date) and an assignment window. An assignment applies from its
`effective_from` until the day before the next assignment for the same
employee and leave type.

The target is rounded to cents of a day once, on the cumulative value, so the
monthly entries of a full year add up to the allowance exactly (22 days gives
22.00, not 21.96).

## Idempotency and catch-up

- Each entry has `source_ref = accrual:<policyId>:<YYYY-MM>`, and the partial
  unique index `leave_ledger_accrual_once` (migration 0030) allows one accrual
  per employee and `source_ref`. A retried or re-enqueued job is a no-op.
- A missed month is caught up by the next run, because the target is
  cumulative. A backdated hire or assignment is picked up the same way.
- If a policy's method changes mid-year, the new method's target is reduced
  by what the policy already accrued that year, so nothing is counted twice.
- An assignment that points to a missing policy, or a policy with an unknown
  `accrual_method`, fails the whole run with `MissingPolicyError` before
  anything is written. The error names the assignment or policy ids.

## Known limitations

- **Scheduling.** The worker's scheduler enqueues `leave.accrue` for each
  organization once a month has ended in its local time, with `runDate` set
  to the month's last day ([job scheduler](job-scheduler.md)). It catches up
  the last 2 days only; a run missed for longer must be enqueued by hand.
- **No true-up.** If the ledger already holds more than is due (for example a
  termination recorded after the month was accrued), the run writes nothing
  and logs a warning with ids only. Corrections are a manual adjustment.
- **FTE is 1.0.** There is no full-time reference to divide
  `employments.working_hours_per_week` by, so part-time contracts accrue like
  full-time ones. This matches statutory vacation in Spain (ET art. 12.4.d)
  but may not suit every leave type.
- **Untyped ledger.** `leave_ledger` has no `leave_type_id`, so balances are
  per employee, not per leave type.
- **No carry-over or expiry runs** yet.
- If a month's entry already exists and a backdated change raises the target,
  the difference is written by the next month's run (for December, not at
  all: each year is accrued on its own).
