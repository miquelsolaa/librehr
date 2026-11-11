-- 0027_time_events_export_indexes.sql
-- TIM-006: indexes for the time-tracking export reads.
--
-- TimeRepository.getEventsForPeriod reads one employee's events in an
-- [from, to) window and then follows TIM-003 correction links in both
-- directions (t.id = r.ref_event_id OR t.ref_event_id = r.id). Before this
-- migration the window needed time_events_employee_idx plus a filter over the
-- employee's whole history, and every "corrections of this event" step had no
-- index on ref_event_id at all. An organization export repeats both per
-- employee, so they grow with the size of time_events.
--
-- Additive only: no column, constraint, policy or grant changes. An index
-- belongs to its table, so it inherits the table's owner and is covered by
-- the existing RLS policies and grants; nothing else is needed.
--
-- The runner wraps each migration in a transaction, so CREATE INDEX
-- CONCURRENTLY is not available. A plain CREATE INDEX holds a SHARE lock on
-- time_events while it builds: reads continue, but inserts (clock-ins and
-- corrections) wait until the build finishes. On large tables run the upgrade
-- in a quiet window. See docs/guides/upgrading.md.
--
-- time_events_employee_idx (employee_id) is now a prefix of
-- time_events_employee_occurred_idx and could be dropped in a later release;
-- it is kept here to keep this migration purely additive.

CREATE INDEX IF NOT EXISTS time_events_employee_occurred_idx
  ON time_events (employee_id, occurred_at);

-- Only corrections carry ref_event_id, so the partial index stays small.
CREATE INDEX IF NOT EXISTS time_events_ref_event_idx
  ON time_events (ref_event_id)
  WHERE ref_event_id IS NOT NULL;
