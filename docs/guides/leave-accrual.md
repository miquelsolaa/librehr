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

## Part-time contracts (issue #118)

By default every contract accrues the full entitlement (FTE 1.0). That is
the **compliance default and must stay so for statutory vacation**: in Spain
part-time staff are entitled to the same vacation days as full-time staff
(ET art. 12.4.d).

A policy can opt in to proration by setting `full_time_hours_per_week`
(migration 0034; Settings > Leave policies, or
`PATCH /v1/leave/policies/{id}`), the full-time week of the collective
agreement (at most 40 hours). Accrual then weights each active day by

    min(1, employments.working_hours_per_week / full_time_hours_per_week)

of the employment row covering it, so a change of contract mid-year counts
each part at its own ratio. Ratios are kept in parts per million of a day
(integers) and the target is still rounded once, to cents, on the cumulative
value; with no full-time week every amount is exactly what it was before.

- The API refuses a full-time week on a policy whose leave type is the
  statutory `vacation` (422 `STATUTORY_LEAVE_NOT_PRORATABLE`).
- The target is cumulative from 1 January, so setting or changing the
  full-time week mid-year recalculates the whole year, months already
  accrued included (a lower target is not trued up, see below).
- The full-time week is capped at 40 hours, the maximum ordinary
  full-time week (ET art. 34.1), in the API and in the database check. A
  contract on the default 40 hours therefore never has its accrual reduced.
- Contract hours come from `employments.working_hours_per_week`, which
  defaults to 40 and is not yet editable in the app (only through data
  imports or the database; issue #131).
- A legacy employee without employment rows has no recorded hours and
  accrues at 1.
- If a prorated policy meets an employment row whose hours are not a
  positive number, the run fails with `InvalidEmploymentDataError` (naming the
  employee ids) before anything is written.
- Reducing hours mid-year lowers the cumulative target; if the ledger
  already holds more, the run writes nothing (no true-up, see below).

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

## Balances per leave type (LEA-005)

Every ledger entry records the leave type it counts toward
(`leave_ledger.leave_type_id`, migration 0033): an accrual takes its
policy's type, a usage or reversal takes its request's type, and an HR
adjustment (`POST /v1/leave/adjust`) states its type explicitly. Balances,
totals and the running "balance after" of the history are computed per type.

Migration 0033 backfilled the type of older entries whose origin is
recorded: usage and reversal entries from their leave request
(`source_ref` is the request id) and accruals of this job from their policy
(`source_ref` is `accrual:<policyId>:<YYYY-MM>`). Anything else written
before 0033 (manual adjustments, hand-seeded rows) stays without a type.

Rule for those **unassigned** entries:

- They are shown as their own "Unassigned" balance and are never added to a
  leave type's balance.
- When a request is checked for sufficient balance, a positive unassigned
  balance acts as a shared legacy pool: it first covers the shortfall of the
  employee's other balance-limited types, and what is left can back the
  request (`availableForLeaveType` in `packages/core`). With only legacy
  entries this is exactly the old pooled balance for those types.
- To retire the pool, HR books a negative adjustment with
  `leaveTypeId: null` and a matching positive one on the right leave type.

Only leave types the employee has (or had) a policy for are
**balance-limited** (`entitled: true` in `GET /v1/leave/balance`). Requests
for other types, such as sick leave or statutory permits, are never refused
for lack of balance and never spend the legacy pool; the web app shows their
days taken instead of a balance. Before 0033 every request was checked
against one pooled balance, so an installation with no policies assigned no
longer limits requests at all: assign policies to enforce entitlements.

## Known limitations

- **No scheduler yet.** Nothing enqueues `leave.accrue`; it must be enqueued
  per organization and month by an operator or a future scheduler.
- **No true-up.** If the ledger already holds more than is due (for example a
  termination recorded after the month was accrued), the run writes nothing
  and logs a warning with ids only. Corrections are a manual adjustment.
- **No carry-over or expiry runs** yet.
- If a month's entry already exists and a backdated change raises the target,
  the difference is written by the next month's run (for December, not at
  all: each year is accrued on its own).
