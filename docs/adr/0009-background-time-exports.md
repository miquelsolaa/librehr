# ADR 0009: Background time exports

## Status

Accepted

## Date

2026-11-26

## Context

The TIM-006 working-time export (`GET /v1/time/export`) is built inside the
request and capped at 50,000 employee-days, because verifying every
employee's hash chain is costly (issue #38). Larger organizations need
exports of a whole year. The worker may import only `core`, `db` and
`emails`, the API has no pg-boss, and only the API had file storage.

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
4. **Storage.** Files are written to local disk under `STORAGE_LOCAL_DIR`,
   shared by the API and the worker (the `librehr_storage` volume in
   compose), with a byte-size guard (`TIME_EXPORT_MAX_FILE_MB`). No
   application-level encryption in v1: the file holds names and working
   times, the same data sits unencrypted in the same database, and giving the
   worker the envelope master key would widen its reach. Revisit if the TTL
   grows or an object-storage adapter lands.
5. **Retention.** A file can be downloaded for `TIME_EXPORT_FILE_TTL_HOURS`
   (default 7 days); `time.export.cleanup` then deletes it hourly and marks
   the row `expired`. The `time_exports` row and the audit entries (id, hash,
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

- API and worker must share one storage directory; running them on hosts
  without a shared volume breaks downloads until an object-storage adapter
  exists.
- A background export reflects the records when it runs, not when it was
  requested; the UI says so.
- One more narrow cross-tenant read for the worker (ids only).
