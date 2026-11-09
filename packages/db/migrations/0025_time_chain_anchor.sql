-- 0025_time_chain_anchor.sql
-- TIM-002: close two gaps in the v2 time-event chain of 0022.
--
-- 1. No new legacy rows. 0022 defaulted hash_version to 1 and accepted v1
--    rows without seq, which the verifier counts as "legacy" and never as
--    tampered: a direct INSERT of an unsigned clock_in counted toward worked
--    hours and still verified. Existing v1 rows are untouched (no UPDATE, so
--    prevent_mod_time_events is not fired); only new inserts are checked.
-- 2. Chain-head anchor. Deleting the newest rows of a chain left a shorter
--    chain that verified. time_event_chain_heads records the newest seq and
--    hash per employee, written by the repository in the same transaction
--    (and advisory lock) as the event; the verifier compares the two.
--
-- Remaining limit (documented in COMPLIANCE.md): a role that can disable
-- triggers or bypass RLS (the owner or a superuser) can rewrite rows, anchor
-- and audit log together. The verifier's per-run head record in audit_log
-- only detects that when it happens after a run that is still on record.

-- 1. New rows are v2 by default and v1 is refused.
ALTER TABLE "time_events" ALTER COLUMN "hash_version" SET DEFAULT 2;

CREATE OR REPLACE FUNCTION librehr_time_events_require_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.hash_version IS DISTINCT FROM 2 OR NEW.seq IS NULL THEN
    RAISE EXCEPTION 'time_events accepts only chained v2 rows (hash_version 2 with seq)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "time_events_require_chain" ON "time_events";
CREATE TRIGGER "time_events_require_chain"
  BEFORE INSERT ON "time_events"
  FOR EACH ROW EXECUTE FUNCTION librehr_time_events_require_chain();
-- prevent_mod_time_events (BEFORE UPDATE OR DELETE, 0001) is unchanged.

-- 2. Chain-head anchor.
CREATE TABLE IF NOT EXISTS "time_event_chain_heads" (
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "last_seq" bigint NOT NULL CHECK ("last_seq" >= 1),
  "last_hash" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "time_event_chain_heads_org_employee_uidx"
  ON "time_event_chain_heads" ("organization_id", "employee_id");

ALTER TABLE "time_event_chain_heads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_event_chain_heads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_event_chain_heads_tenant_isolation" ON "time_event_chain_heads";
CREATE POLICY "time_event_chain_heads_tenant_isolation" ON "time_event_chain_heads"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- The anchor may only move forward to the employee's real newest link, so the
-- runtime role cannot point it anywhere else: an INSERT or UPDATE must name a
-- stored v2 row with that seq and hash and no newer row may exist, and an
-- UPDATE must advance last_seq and keep the key.
CREATE OR REPLACE FUNCTION librehr_time_chain_head_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
      RAISE EXCEPTION 'time_event_chain_heads key is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.last_seq <= OLD.last_seq THEN
      RAISE EXCEPTION 'time_event_chain_heads can only move forward'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.time_events te
    WHERE te.organization_id = NEW.organization_id
      AND te.employee_id = NEW.employee_id
      AND te.seq = NEW.last_seq
      AND te.hash = NEW.last_hash
      AND te.hash_version = 2
  ) OR EXISTS (
    SELECT 1 FROM public.time_events te
    WHERE te.organization_id = NEW.organization_id
      AND te.employee_id = NEW.employee_id
      AND te.seq > NEW.last_seq
  ) THEN
    RAISE EXCEPTION 'time_event_chain_heads must name the newest stored link'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "time_event_chain_heads_guard" ON "time_event_chain_heads";
CREATE TRIGGER "time_event_chain_heads_guard"
  BEFORE INSERT OR UPDATE ON "time_event_chain_heads"
  FOR EACH ROW EXECUTE FUNCTION librehr_time_chain_head_guard();

DROP TRIGGER IF EXISTS "prevent_delete_time_event_chain_heads" ON "time_event_chain_heads";
CREATE TRIGGER "prevent_delete_time_event_chain_heads"
  BEFORE DELETE ON "time_event_chain_heads"
  FOR EACH ROW EXECUTE FUNCTION openhr_prevent_modification();

-- Default privileges (0015) grant UPDATE/DELETE on new tables; the runtime
-- roles keep SELECT, INSERT and UPDATE (the repository upsert) only.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON "time_event_chain_heads" TO %I',
        runtime_role
      );
      EXECUTE format(
        'REVOKE DELETE, TRUNCATE ON "time_event_chain_heads" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

-- 3. Backfill the anchor of every existing v2 chain. RLS is forced for the
-- owner too, so each organization is processed under its own tenant setting.
DO $$
DECLARE
  org record;
  previous text := current_setting('app.current_org', true);
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    PERFORM set_config('app.current_org', org.id::text, true);
    INSERT INTO public.time_event_chain_heads (organization_id, employee_id, last_seq, last_hash)
    SELECT DISTINCT ON (te.employee_id) te.organization_id, te.employee_id, te.seq, te.hash
    FROM public.time_events te
    WHERE te.organization_id = org.id AND te.seq IS NOT NULL AND te.hash_version = 2
    ORDER BY te.employee_id, te.seq DESC
    ON CONFLICT (organization_id, employee_id) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.current_org', coalesce(previous, ''), true);
END $$;
