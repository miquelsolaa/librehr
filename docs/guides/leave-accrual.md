# Leave accrual (LEA-002)

The `leave.accrue` worker job turns leave policy assignments into `accrual`
entries in the append-only `leave_ledger`, closes each leave year
(`carryover` and `forfeit` entries) and expires unused carried-over days
(`expiry` entries). Balances are derived from that ledger (LEA-005); no
balance column is ever updated.

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

### Which month a run plans (issue #129)

`monthly` and `daily` policies earn days as time passes, so a run accrues the
month of `runDate`, which has just ended. `upfront` policies are credited
for the **month that starts** after `runDate` instead: the scheduled run for
December (it runs just after midnight on 1 January) credits the next year's
whole allowance, dated 1 January, and the run for May credits an employee
who joins on 15 June, dated 15 June. Their entries are keyed by the credited
month (`accrual:<policyId>:2027-01`), so re-runs stay no-ops. We chose this
over a second, start-of-month run because it needs no new schedule, payload
or job, and the scheduled runs already fire at the start of each month.

### True-up

When the ledger holds more than the year-to-date target (a termination,
an assignment end or a shorter contract recorded after the month was
accrued), the run writes a **negative `accrual` entry** for the excess under
the same `accrual:<policyId>:<YYYY-MM>` ref, so there is still at most one
entry per policy and month. It is dated on the employee's first active day of
the month, or their last active day before it (for a late termination, the
termination date). It is an `accrual`, not an `adjustment`, because:

- the year-to-date maths sums `accrual` entries by ref; a correcting
  `accrual` keeps that sum equal to the target, so the next run is up to
  date, while an `adjustment` would be invisible to it and the run would
  claw the same days back every month;
- `adjustment` entries are HR's own corrections, with a reason (LEA-010);
  this one is the system recomputing its own accrual.

A change of accrual method mid-year applies the new method's target to the
whole year, so it can also produce a true-up.

## Year end: carry-over, forfeit and expiry (issue #116)

**Losing days is off by default.** Each leave policy has
`carryover_enforced` (migration 0036, default `false`; Settings > Leave
policies, or `PATCH /v1/leave/policies/{id}` with `carryoverEnforced`).
While it is off, the year-end close carries the **whole** remaining balance
over and never writes a `forfeit` or an `expiry`: `carryover_max_days` and
`carryover_expiry_months` have no effect. Turning it on (audited) applies
the cap, the forfeit and the expiry below. Even then, employees protected by
ET art. 38.3 keep their days at the closes of the year of the protected leave and of the year after (see [Protected leave](#protected-leave-et-art-383)).

How LibreHR applies ET art. 38.3 is **pending legal review** (issue #133).
In Settings > Leave policies, turning enforcement on opens a confirmation
that summarises the cap, the expiry month, the ET 38.3 shield and the
limits below, and the administrator must tick an acknowledgement before
saving. Enforced policies then show a "pending legal review" notice.
Turning it off needs no confirmation. The acknowledgement is not sent to
the API; the change is audited as `leave.policy.update`. The open questions
are in
[`docs/compliance/et-38-3-carryover-questions.md`](../compliance/et-38-3-carryover-questions.md).

The ledger is cumulative: a leave type's balance is the sum of all of its
entries, so what is left at year end is already in next year's balance. The
**January run** (`runDate` in January, which runs just after January ends)
settles and closes the previous year, in this order:

1. **Final true-up.** For every policy that applied in the previous year, it
   compares the whole year's target with what was accrued and writes the
   difference, positive or negative, as one `accrual` entry with
   `source_ref = accrual:<policyId>:<YYYY>-final`. This writes a December
   change recorded after December was accrued (a backdated termination,
   hire or assignment) and a December run that was missed.
2. **Close.** For each employee employed on some day from 31 December to the
   run date (so a fixed-term contract that ended in December and restarted
   in January is closed too), and each leave type they have a policy for on
   31 December, the balance up to and including 31 December (`B`) is split:
   - not enforced, or protected: `C = B` is carried over, `F = 0`;
   - enforced: `C = min(B, carryover_max_days)` is carried over and
     `F = B − C` is forfeited.

   It writes, all with the leave type:

   | Entry       | Amount | Date        | `source_ref`                           |
   | ----------- | ------ | ----------- | -------------------------------------- |
   | `carryover` | −C     | 31 December | `carryover:<leaveTypeId>:<YYYY>:close` |
   | `carryover` | +C     | 1 January   | `carryover:<leaveTypeId>:<YYYY>`       |
   | `forfeit`   | −F     | 31 December | `forfeit:<leaveTypeId>:<YYYY>`         |

   The `carryover` pair moves C from one year into the next, so a history
   read per year shows "carried over: C" on 1 January, while the balance only
   drops by F. A zero or negative balance writes nothing (a negative balance
   stays owed). Usage booked for dates in the new year does not count.

   On an enforced, unprotected close the +C entry records its **expiry
   date** in `leave_ledger.expires_on`: the last day of month
   `carryover_expiry_months` of the new year (3: 31 March; clamped to
   1..12), computed from the policy as it stood at the close. Editing the
   policy later, or turning enforcement off, never moves or cancels an
   expiry already fixed; turning it on never adds one to an earlier close.
   Unenforced and protected closes leave it empty: those days never expire.

Then, in every run, days carried over from the previous year whose expiry
date has passed are expired:

3. **Expiry.** The run for the expiry month (the March run, executing on
   1 April) writes `expiry`, −U, dated on the expiry date, ref
   `expiry:<leaveTypeId>:<YYYY>`, where U is the carried amount minus the
   days of that type used by requests starting from 1 January to the expiry
   date, floored at 0, and never more than the type's balance on the expiry
   date (an expiry never makes a balance negative). Usage is counted against
   carried days first. A request is counted by its start date: one that
   starts by the expiry date and runs past it counts entirely against carried
   days. A request cancelled after the expiry ran gives its days back as
   ordinary balance, not as carried days. An employee with protected leave
   between 1 January and the expiry date keeps the carried days (see below).

### Protected leave (ET art. 38.3)

Vacation that could not be taken because of temporary incapacity,
pregnancy (including risk during pregnancy), birth, adoption or
breastfeeding may be taken after that leave ends (for incapacity, up to
18 months after the end of the year in which it accrued). So, even on an
enforced policy:

- an employee with **approved** leave of such a type overlapping the year
  being closed **or the year before** is carried over in full (no forfeit,
  no expiry date). Looking back one year means days carried over whole
  because of protected leave are not capped again at the next close;
- an expiry is not applied for an employee with such leave between
  1 January and the expiry date. A zero `expiry` entry records that nothing
  expired, so the carry-over is settled and reported once.

Beyond that (the close two years after the protected leave), the cap
applies again. Leave approved after the close ran is not taken into
account: restore those days with an adjustment. Leave types only have a
free-text code, so the rule is cautious (`protectsVacation` in
`packages/core`):

- the codes `sick_leave`, `temporary_incapacity`, `pregnancy_risk`,
  `prenatal_exams`, `maternity`, `paternity`, `birth_childcare`, `adoption`,
  `breastfeeding` and `breastfeeding_risk` always protect;
- any other leave type that is not an entitlement of the employee (no
  policy by the end of the period) protects too, unless its code is a
  known ordinary permit (`marriage`, `moving`, `bereavement`,
  `unpaid_leave`, ...). A custom type coded `other` therefore protects, as
  the safe fallback. `prenatal_exams` is a paid permit rather than an ET
  38.3 case and is listed on the safe side; counsel should confirm the list.

The worker logs a neutral warning ("statutory exemption") with ids only
(employee, leave type of the balance, policy), never the protected absence
or its type, and counts it in
the job report (`yearEnd.protectedFromForfeit`, `protectedFromExpiry`).
There is no in-app notification yet; HR can follow the job report. Grant
extra days or restore forfeited ones with an adjustment.

### Idempotency and other rules

Each ref holds the leave type and the closed year, and the partial unique
index `leave_ledger_year_end_once` (migration 0036) allows each one once per
employee, so a re-run is a no-op. A year that is already closed for an
employee and type is never closed again, even if a backdated entry changed
its balance since: correct that with an adjustment. The refs are keyed by
leave type rather than policy because the balance closed is the type's: an
employee whose policy for a type changed during the year (or whose
assignment is corrected later) still has one close per type and year.

- **The unassigned bucket is never closed.** Entries without a leave type
  (legacy rows from before 0033) are never carried over, forfeited or
  expired automatically. HR moves them to a leave type with a pair of
  adjustments (see below), after which they follow the rules above.
- Leave types without a policy on 31 December (sick leave, statutory
  permits, or a type whose policy was replaced by another type's during the
  year) are never closed.
- Employees who left before 31 December and are not employed again by the
  run date are not closed: their remaining days are settled on termination,
  by HR.
- Every number (cap, expiry months) comes from the policy; nothing is
  defaulted in code.
- The lifetime `totalCarryover` of `GET /v1/leave/balance` nets the
  −C/+C pairs to 0; forfeited and expired days are in `totalExpired`.
- Two runs with different January dates (for example one enqueued by hand)
  may overlap; the unique indexes make the second one's writes no-ops.

The job's report (logged with ids and counts only) has a `yearEnd` section
for January runs, and `expiries` and `protectedFromExpiry` counts.

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
- Contract hours come from `employments.working_hours_per_week`
  (`numeric(5,2)` since migration 0037, default 40, database check
  `> 0 and <= 40`). Administrators set them when creating an employee or
  adding an employment period (People > profile > Employment history, or
  `POST /v1/employees/{id}/employment-history` with `workingHoursPerWeek`).
- A change of hours is a new employment period: an open-ended period that
  starts after the start of the open-ended current one closes it the day
  before, so the hours of earlier periods are kept and each part of the year
  accrues at its own ratio. A new period with an end date that overlaps the
  current one is refused (409), as is any other overlap. Editing hours in
  place is not offered (issue #131). Each close is audited as
  `employee.employment_period_closed` with the period id and end date.
- **Backdated changes.** A new period may start in the past. If it starts in
  a month that has already accrued, the cumulative target is recomputed with
  the new hours: a reduction offsets future accrual (the following runs write
  less, or nothing, until the target catches up; nothing already credited is
  taken back, see "no true-up" below), and an increase is credited on the
  next run. The employment history form warns when the start date is before
  the current month.
- A legacy employee without employment rows has no recorded hours and
  accrues at 1.
- Migration 0037 converted the earlier text values (a decimal comma such as
  `37,5` is read as 37.5). If any value is not a number in (0, 40], the
  migration stops, quoting the refused value but no row or person, and
  changes nothing; its hint gives the query that lists the rows to correct
  from the contracts before running it again. It does not lift row level
  security: the conversion and the check run as DDL.
- The job still refuses (with `InvalidEmploymentDataError`, naming employee
  ids, before anything is written) hours that are not a positive number; the
  column type now rules this out.
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

- **Scheduling is opt-in.** When `SCHEDULER_JOBS` lists `leave.accrue`, the
  worker's scheduler enqueues it for each organization once a month has ended
  in its local time, with `runDate` set to the month's last day
  ([job scheduler](job-scheduler.md)). It is off by default because a first
  run does not subtract manual `adjustment` entries; see
  [upgrading](upgrading.md#job-scheduler-migration-0035). It catches up
  the last 2 days only; a run missed for longer must be enqueued by hand.
  Carry-over and expiry run inside `leave.accrue`, so they are opt-in too.
- **The year is closed once, by the January run.** If that run is missed
  (worker down for more than 2 days around 1 February), enqueue it by hand
  with `runDate` = 31 January ([job scheduler](job-scheduler.md)). Until it
  runs, the previous year's balance is not capped. A change to the previous
  year recorded after the January run is not trued up: book an adjustment.
- If a month's entry already exists and a backdated change alters the
  target, the difference is written by the next month's run (for December,
  by the January run's final true-up).
