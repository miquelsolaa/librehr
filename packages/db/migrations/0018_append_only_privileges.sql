-- 0018_append_only_privileges.sql
-- 0015 granted UPDATE and DELETE on every table to the runtime roles, which
-- undid the append-only revoke of 0001. Withdraw them again so the database
-- refuses the statement by privilege before the prevent_mod_* triggers (kept
-- as a second line of defence) ever run.
--
-- Append-only tables (AGENTS.md section 5): time_events, leave_ledger,
-- audit_log. A future append-only table must repeat this revoke, because the
-- default privileges set in 0015 grant UPDATE/DELETE on every new table.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON "time_events", "leave_ledger", "audit_log" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;
