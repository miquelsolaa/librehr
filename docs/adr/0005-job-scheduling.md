# ADR 0005: Scheduling periodic worker jobs

## Status

Accepted

## Date

2026-11-22

## Context

The worker has periodic jobs (`time.close-day`, `leave.accrue`,
`audit.verify-chain`, `retention.enforce`) whose periods are local calendar
days or months of each organization, but nothing enqueued them (issue #115).
Scheduling them needs a timer, the list of organizations across tenants, and
each organization's time zone.

## Decision

1. **The schedule lives in pg-boss.** The worker installs one cron schedule,
   `scheduler.tick` (default every 15 minutes, UTC) with `boss.schedule`. No
   external cron, no new service. Disabling the scheduler unschedules it.
2. **A dispatcher decides what is due.** Each tick lists the organizations and,
   per organization, computes the due periods with the pure
   `dueScheduledJobs` (`packages/core/src/scheduler`), in every zone the
   organization uses (organization and location zones). It looks back over
   the last 2 closed local days, so missed ticks are caught up.
3. **Dedupe by singleton key.** Payloads and keys are the queues' existing
   ones. A period is skipped while pg-boss holds a job with its key in any
   state but `cancelled`; the 2-day window stays below the 3 days pg-boss
   keeps finished jobs.
4. **One narrow cross-tenant read.** Organizations are listed through the
   `SECURITY DEFINER` function `librehr_scheduler_organizations()` (migration
   0035), which returns only ids and time zones, has a pinned `search_path`,
   and is executable only by its owner, `librehr_owner`, the worker's role.
   No RLS is disabled and no role gets `BYPASSRLS`; all other reads use
   `withTenant`.

## Consequences

- Operating the schedule needs nothing beyond the worker
  (`docs/guides/job-scheduler.md`).
- An outage longer than 2 days needs periods enqueued by hand; accrual
  catches up by itself within a year.
- If `organizations` ever gets RLS, the function needs an owner-scoped policy
  like the identity lookups of migrations 0019/0020.
