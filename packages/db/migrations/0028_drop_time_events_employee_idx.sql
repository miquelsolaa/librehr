-- 0028_drop_time_events_employee_idx.sql
-- TIM-006 follow-up: drop the single-column index on time_events.employee_id.
--
-- Migration 0027 added time_events_employee_occurred_idx (employee_id,
-- occurred_at). Its leading column is employee_id, so it serves every lookup
-- the old index did: queries filtering on employee_id alone, the
-- employee_id + occurred_at reads, and the ON DELETE CASCADE check of the
-- employee_id foreign key. Keeping both only costs space and slows every
-- insert (clock-ins) for no gain.
--
-- DROP INDEX takes a brief ACCESS EXCLUSIVE lock on time_events; it does not
-- rebuild anything, so it finishes almost immediately.

DROP INDEX IF EXISTS time_events_employee_idx;
