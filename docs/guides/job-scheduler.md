# Job scheduler

The worker runs the periodic jobs of every organization on its own: no
external cron and no extra service. The schedule is stored in pg-boss, in the
same database as everything else.

## What runs when

A dispatcher job, `scheduler.tick`, runs on a cron (every 15 minutes by
default, in UTC). Each tick lists the organizations and, for each one, enqueues
the jobs that are due in its local time:

| Job                  | Period     | Due once                                  | Payload                                               |
| -------------------- | ---------- | ----------------------------------------- | ----------------------------------------------------- |
| `time.close-day`     | each day   | that day has ended (local midnight+grace) | `{ organizationId, closeDate }`                       |
| `audit.verify-chain` | each day   | that day has ended                        | `{ organizationId, runDate }`                         |
| `retention.enforce`  | each day   | that day has ended                        | `{ organizationId, runDate, dryRun: true }`           |
| `leave.accrue`       | each month | the month's last day has ended            | `{ organizationId, runDate }` (last day of the month) |

`leave.accrue` is **opt-in**: it runs only when `SCHEDULER_JOBS` lists it.
Its first run writes the year-to-date accrual minus earlier `accrual` entries
but does not subtract manual `adjustment` entries, so on an install whose
balances were kept right by hand it could credit days twice. Review the ledger
([upgrading](upgrading.md#job-scheduler-migration-0035)) before enabling it:

```bash
SCHEDULER_JOBS=time.close-day,audit.verify-chain,retention.enforce,leave.accrue
```

"Local" means every time zone the organization uses: its own and those of its
locations. A day is closed only once it has ended in all of them, so with a
Madrid office and a Canary Islands location, close-day for a date runs after
00:30 in the Canaries (01:30 in Madrid), not before.

The grace (`SCHEDULER_GRACE_MINUTES`, default 30) is elapsed time after local
midnight, so it also holds on the 23 and 25 hour days of a DST change.

## Duplicates and catch-up

- Each job is keyed by its singleton key (`<organizationId>:<date>`). A tick
  skips a period that pg-boss still holds in any state other than
  `cancelled`, and the queues' `exclusive` policy rejects a concurrent
  duplicate. Ticks are therefore safe to repeat, and every handler is
  idempotent as well.
- Each tick looks back over the **last 2 closed local days**. If the worker
  was down, the first tick after it comes back (pg-boss sends one tick for
  the missed occurrences) enqueues what fell due in those 2 days, including
  the previous month's accrual if the month ended in that window.
- The window is shorter than the 3 days pg-boss keeps finished jobs
  ([job data retention](self-hosting.md#3-background-job-data-retention)),
  which is what keeps a completed period from being enqueued again.
- After a longer outage, older periods are not enqueued automatically. Leave
  accrual catches up by itself (each run accrues the year to date), except a
  December that was missed entirely. Enqueue a missed period by hand with
  the same payload, for example from the worker container:

  ```bash
  docker compose --env-file .env -f infra/compose/docker-compose.yml run --rm -w /app/apps/worker worker \
    node --input-type=module -e "import { PgBoss } from 'pg-boss'; const b = new PgBoss({ connectionString: process.env.DATABASE_MIGRATION_URL, schema: 'pgboss' }); await b.start(); await b.send(process.argv[1], JSON.parse(process.argv[2]), { singletonKey: process.argv[3] }); await b.stop();" \
    leave.accrue '{"organizationId":"<org id>","runDate":"2026-12-31"}' '<org id>:2026-12-31'
  ```

To re-run a period on purpose, cancel or delete its old job first; otherwise
the next tick leaves it alone.

## Listing organizations

The tick reads the organization list through the SQL function
`librehr_scheduler_organizations()` (migration 0035). It returns only
`(organization_id, timezone)`, is `SECURITY DEFINER` with a pinned
`search_path`, and only `librehr_owner`, the worker's role, may call it; the
API's `librehr_app` role and `PUBLIC` may not. It does not by itself hide
tenant ids: `organizations` has no Row-Level Security and `librehr_app` can
read it directly. It is the scheduler's one narrow read without a tenant
context. Everything else the scheduler and the jobs read goes through
`withTenant` and Row-Level Security. The worker must therefore connect as
`librehr_owner` (`DATABASE_MIGRATION_URL`), as the bundled compose file does;
otherwise every tick fails with `permission denied`.

## Configuration

| Variable                  | Default         | Meaning                                                                                    |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `SCHEDULER_ENABLED`       | `true`          | `false` removes the stored tick schedule at worker start                                   |
| `SCHEDULER_TICK_CRON`     | `*/15 * * * *`  | Five-field cron, in UTC, of the dispatcher tick; at least once a day                       |
| `SCHEDULER_GRACE_MINUTES` | `30`            | Minutes after local midnight before a day counts as closed (0 to 720)                      |
| `SCHEDULER_JOBS`          | all but accrual | Comma-separated subset of the four jobs above; empty means every job except `leave.accrue` |

Invalid values stop the worker at startup, including a tick cron with gaps of
more than 24 hours (periods older than the catch-up window would be lost).
Every worker instance installs the schedule and the last one to start wins,
so give every instance the same `SCHEDULER_*` values; pg-boss sends one tick
per occurrence however many instances run. A tick that reaches a worker with
`SCHEDULER_ENABLED=false` does nothing.

## Known limitations

- **`retention.enforce` is not implemented yet (ADM-005).** It is scheduled
  daily but dead-letters by design until it is, so each organization gets one
  failed `retention.enforce` job per day, which makes the gap visible (see
  `COMPLIANCE.md` §5). Leave it out with `SCHEDULER_JOBS` if you prefer. The
  scheduler always sends `dryRun: true`: turning scheduled purges on is a
  compliance decision for ADM-005, not a scheduler default.
- **Accrual is credited after the month.** `leave.accrue` runs once a month
  has ended, so an `upfront` policy's annual allowance is first credited
  after 31 January, and `monthly` and `daily` credits arrive the following
  month. Crediting at the start of a period is an open product decision.
- A tick logs organization ids and counts only. An organization whose time
  zone is invalid is skipped and logged by id (the log message is
  `scheduler skipped an organization`); the others still run.
