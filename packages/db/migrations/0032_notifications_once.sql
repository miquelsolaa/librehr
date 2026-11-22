-- 0032_notifications_once.sql
-- TIM-003: at most one missing clock-out reminder per user and day.
--
-- The time.close-day job (#109) notifies an employee left clocked in at the
-- end of their local day, with link = '/time/corrections?date=<YYYY-MM-DD>'.
-- pg-boss delivers jobs at least once, so the reminder must be idempotent per
-- (organization, user, category, link). Until now NotificationRepository
-- .createOnce checked before inserting under an advisory lock; from this
-- release it inserts with ON CONFLICT DO NOTHING against this index, so the
-- database itself guarantees a single row even across concurrent runs.
--
-- Partial (category = 'time_missing_clock_out'): every other category may
-- still repeat the same link (e.g. several leave decisions for one request),
-- and rows with a NULL link never conflict.
--
-- Safe on a populated database. Nothing schedules the job yet, so no row of
-- this category should exist. Step 1 still removes any duplicates
-- defensively (keeping the oldest row of each key, which is what a user would
-- have seen first) so that CREATE UNIQUE INDEX cannot fail. The rows removed
-- are exact repeats of a reminder that is kept; no other category is touched.
--
-- notifications is under FORCE ROW LEVEL SECURITY, which binds the owner role
-- too, so the DELETE would see no rows. As in 0026, the owner lifts FORCE for
-- this one statement and restores it in the same transaction (the runner
-- wraps each migration in one), so no other session observes the table
-- without it. The index build itself is not subject to RLS.
--
-- The runner's transaction rules out CREATE INDEX CONCURRENTLY: the build
-- holds a SHARE lock on notifications, so reads continue while new
-- notifications wait until it finishes. Only rows of this category are
-- indexed, so the build is short.
--
-- Rollback note: DROP INDEX notifications_missing_clock_out_once; (createOnce
-- would then no longer deduplicate; restore the previous release's
-- check-before-insert first).

-- 1. Defensive dedupe (expected to delete nothing).
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;
DELETE FROM "notifications" n
USING "notifications" keep
WHERE n."category" = 'time_missing_clock_out'
  AND keep."category" = 'time_missing_clock_out'
  AND keep."organization_id" = n."organization_id"
  AND keep."user_id" = n."user_id"
  AND keep."link" = n."link"
  AND (keep."created_at", keep."id") < (n."created_at", n."id");
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;

-- 2. The idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_missing_clock_out_once"
  ON "notifications" ("organization_id", "user_id", "category", "link")
  WHERE "category" = 'time_missing_clock_out';
