# ADR 0009: Background time exports

## Status

Accepted. The storage choice (decision 4) follows the maintainer's approval
of the plan on 2026-11-26 (plan decision 1, option A: a Postgres `bytea`
table under FORCE RLS).

## Date

2026-11-26

## Context

The TIM-006 working-time export (`GET /v1/time/export`) is built inside the
request and capped at 50,000 employee-days, because verifying every
employee's hash chain is costly (issue #38). Larger organizations need
exports of a whole year. The worker may import only `core`, `db` and
`emails`, the API has no pg-boss, and only the API had file storage. The API
and the worker may run on different hosts and share only the database.

## Decision

1. **Same builder for both paths.** The export orchestration moved to a new
   workspace package, `@librehr/time-export` (depends on `core` and `db`, no
   HTTP context), used by the API's synchronous route and the worker, so both
   produce the same document and hash for the same data.
2. **Thresholds.** Up to 50,000 employee-days stays synchronous and
   unchanged; organization exports above it run in the background up to
   500,000 (`OFFICIAL_EXPORT_ASYNC_MAX_EMPLOYEE_DAYS`). Employee exports are
   always synchronous. The synchronous 422 carries `asyncAvailable` so clients
   can offer the background path.
3. **Outbox and dispatch.** `POST /v1/time/exports` only inserts a queued
   `time_exports` row (migration 0045). The worker's `time.export.dispatch`
   (every minute, independent of `SCHEDULER_ENABLED`) reads queued ids through
   the `SECURITY DEFINER` function `librehr_queued_time_exports` (owner-only,
   same pattern as ADR 0006) and enqueues `time.export` with ids only. The API
   stays free of pg-boss; pickup takes up to a minute. `NOTIFY` is a possible
   later optimisation.
4. **Storage.** The bytes of a ready export live in Postgres, in the
   `time_export_files` table (`bytea`, one row per export, migration 0045),
   under ENABLE + FORCE RLS with the usual tenant policy. The runtime role
   may only read it; the worker (owner role) inserts the bytes in the same
   transaction that marks the export `ready`, writes the audit entry and the
   notification, and deletes them in the transaction that marks it
   `expired`. A composite foreign key ties each file row to its export in
   the same organization, with `ON DELETE CASCADE`, so no file can outlive
   its record, a crashed run leaves nothing behind, and no shared volume or
   host is needed. Size is bounded by `TIME_EXPORT_MAX_FILE_MB` (default
   100). No application-level encryption in v1: the file holds names and
   working times, the same data sits unencrypted in the same database, and
   giving the worker the envelope master key would widen its reach. Revisit
   if the TTL grows.

   Rejected: files on local disk under `STORAGE_LOCAL_DIR` shared by the API
   and the worker. It breaks downloads when the two run on different hosts or
   working directories, gives the bytes no RLS isolation, and can orphan
   files (a crash between writing the file and committing, a failed delete,
   or an organization deletion cascading only the rows).

5. **Retention.** A file can be downloaded for `TIME_EXPORT_FILE_TTL_HOURS`
   (default 7 days); `time.export.cleanup` then deletes it hourly and marks
   the row `expired`, and fails runs left `running` by a dead worker for
   more than 4 hours (`EXPORT_STALLED`), notifying their requesters. A
   `time.export` job expires in pg-boss after 1 hour
   (`TIME_EXPORT_EXPIRE_SECONDS`), not the 15-minute default, so a slow build
   near the cap is not started a second time while it still runs. The `time_exports` row and the audit entries (id, hash,
   period, requester) are kept for at least 4 years (COMPLIANCE.md).
6. **Access and audit.** Only the requester sees and downloads an export, and
   only while they still hold organization-wide `time.record.read` (a lapsed
   TIM-008 auditor loses access); anyone else gets 404. The worker writes the
   same ADM-002 `time.export` entry as the synchronous path, plus
   `delivery: "async"`; each download writes `time.export.download`.
7. **Notification.** In-app only, linking to `/time/export?job=<id>`. Email
   is a follow-up: the worker has no `APP_URL` and email payloads stay in
   pg-boss rows for days.

## Consequences

- Ready export files add to the database size (and its backups) for up to
  the TTL; the size cap and the 7-day default bound it. Backups taken in
  that window contain the files, so expire backups under the retention
  policy.
- A background export reflects the records when it runs, not when it was
  requested; the UI says so.
- One more narrow cross-tenant read for the worker (ids only).
