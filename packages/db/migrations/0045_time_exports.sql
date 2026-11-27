-- 0045_time_exports.sql
-- TIM-006 (issue #38): organization time exports above the synchronous cap
-- run as a background job in the worker, which stores the file in the
-- database for a limited time and lets the requester download it.
--
-- `time_exports` is both the outbox and the record of what was issued. The
-- API inserts a 'queued' row; the worker's per-minute dispatch lists queued
-- rows through librehr_queued_time_exports() below and enqueues one pg-boss
-- job per row (the API never talks to pg-boss). The job claims the row
-- ('running'), builds the export and, in one transaction, stores its bytes in
-- `time_export_files` and marks the row 'ready' with the content hash, size
-- and expiry. At expiry the worker deletes the bytes and marks the row
-- 'expired', again in one transaction, so no file can outlive its record.
--
-- The bytes live in Postgres (bytea, TOASTed) rather than on a disk shared by
-- the api and the worker: tenant isolation comes from RLS like every other
-- table, the api and worker need no shared volume or host, and backups,
-- organization deletion (ON DELETE CASCADE) and the expiry sweep all see the
-- same data. Size is bounded by TIME_EXPORT_MAX_FILE_MB. See ADR 0009.
--
-- Retention: the file lives for a configurable TTL (7 days by default); this
-- row (id, period, requester id, content hash) is kept with the ADM-002 audit
-- entry for at least 4 years (TIM-007), as the trace of what was issued. The
-- row holds no names or working times; the generation metadata of the
-- document (requester name and role, organization name) is read when the job
-- runs, because the job re-checks the requester's permission then anyway.
--
-- Tenancy: ENABLE + FORCE RLS with the usual tenant policy on both tables.
-- The runtime role may insert and read export rows (request, status) and
-- only read file rows (download); only the worker (the owner role) updates
-- export rows and inserts or deletes file rows. Export rows are never
-- deleted by the application.
--
-- New tables and function only (additive), safe on a populated database.
-- Rollback (forward-only in practice): DROP FUNCTION
-- public.librehr_queued_time_exports(integer); DROP TABLE time_export_files;
-- DROP TABLE time_exports.

CREATE TABLE IF NOT EXISTS "time_exports" (
  -- Also the exportId printed in the document and the audit entry.
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  -- users.id of the requester; the only person who may see or download it.
  -- No foreign key, like audit actor ids: the trace outlives the account.
  "requested_by" uuid NOT NULL,
  "scope" text NOT NULL DEFAULT 'organization',
  "format" text NOT NULL,
  "locale" text NOT NULL,
  -- Local calendar days of the period (inclusive), not instants.
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  -- Size estimate at request time (employees x days), checked against the
  -- async cap by the API.
  "employee_days" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "content_hash" text NULL,
  "employee_count" integer NULL,
  "byte_size" bigint NULL,
  -- Coarse machine code (e.g. EXPORT_FAILED), never a message or stack.
  "error_code" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz NULL,
  "completed_at" timestamptz NULL,
  "expires_at" timestamptz NULL,
  CONSTRAINT "time_exports_scope_check" CHECK ("scope" IN ('organization')),
  CONSTRAINT "time_exports_format_check" CHECK ("format" IN ('csv', 'pdf')),
  CONSTRAINT "time_exports_locale_check" CHECK ("locale" IN ('ca', 'es', 'en')),
  CONSTRAINT "time_exports_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "time_exports_employee_days_check" CHECK ("employee_days" > 0),
  CONSTRAINT "time_exports_status_check"
    CHECK ("status" IN ('queued', 'running', 'ready', 'failed', 'expired')),
  CONSTRAINT "time_exports_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "time_exports_content_hash_check"
    CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "time_exports_byte_size_check"
    CHECK ("byte_size" IS NULL OR "byte_size" > 0),
  CONSTRAINT "time_exports_error_code_check"
    CHECK ("error_code" IS NULL OR "error_code" ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT "time_exports_ready_check"
    CHECK (
      "status" <> 'ready'
      OR ("content_hash" IS NOT NULL AND "employee_count" IS NOT NULL
          AND "byte_size" IS NOT NULL
          AND "completed_at" IS NOT NULL AND "expires_at" IS NOT NULL)
    ),
  CONSTRAINT "time_exports_failed_check"
    CHECK ("status" <> 'failed' OR "error_code" IS NOT NULL),
  -- Target of the composite foreign key of time_export_files, so a file row
  -- can only belong to an export of its own organization.
  CONSTRAINT "time_exports_id_org_key" UNIQUE ("id", "organization_id")
);

-- The requester's own exports, newest first.
CREATE INDEX IF NOT EXISTS "time_exports_requester_idx"
  ON "time_exports" ("organization_id", "requested_by", "created_at" DESC);
-- At most one queued or running export per requester. The API inserts with
-- ON CONFLICT DO NOTHING against this index, so two concurrent requests
-- cannot both pass the check.
CREATE UNIQUE INDEX IF NOT EXISTS "time_exports_one_active_per_requester_idx"
  ON "time_exports" ("organization_id", "requested_by")
  WHERE "status" IN ('queued', 'running');
-- Dispatch (cross-tenant, oldest first) and the per-organization count.
CREATE INDEX IF NOT EXISTS "time_exports_active_idx"
  ON "time_exports" ("created_at", "organization_id")
  WHERE "status" IN ('queued', 'running');
-- Cleanup of files past their expiry.
CREATE INDEX IF NOT EXISTS "time_exports_ready_expiry_idx"
  ON "time_exports" ("organization_id", "expires_at")
  WHERE "status" = 'ready';

ALTER TABLE "time_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_exports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_exports_tenant_isolation" ON "time_exports";
CREATE POLICY "time_exports_tenant_isolation" ON "time_exports"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- The dispatch function below runs as its owner (librehr_owner), which has
-- no BYPASSRLS and is bound by FORCE RLS. As in 0019, a SELECT-only policy
-- for the owner opens queued rows to it, and only while
-- `librehr.export_dispatch` is 'on', which only that function switches on.
-- The policy never applies to librehr_app.
DROP POLICY IF EXISTS "time_exports_dispatch" ON "time_exports";
CREATE POLICY "time_exports_dispatch" ON "time_exports"
  FOR SELECT TO CURRENT_USER
  USING (
    current_setting('librehr.export_dispatch', true) = 'on'
    AND status = 'queued'
  );

-- Default privileges (0015) grant UPDATE/DELETE on new tables; the runtime
-- roles keep SELECT and INSERT only (request, status, download).
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('GRANT SELECT, INSERT ON "time_exports" TO %I', runtime_role);
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON "time_exports" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

-- The stored file of a ready export (TIM-006, ADR 0009). One row per export,
-- written in the transaction that marks the export ready and deleted in the
-- one that marks it expired. Deleting the organization or the export row
-- deletes the bytes with it. No names in the row; the content is the
-- export document itself (special care: it holds working-time records).
CREATE TABLE IF NOT EXISTS "time_export_files" (
  "export_id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL
    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "content" bytea NOT NULL,
  CONSTRAINT "time_export_files_export_fk"
    FOREIGN KEY ("export_id", "organization_id")
    REFERENCES "time_exports"("id", "organization_id") ON DELETE CASCADE
);

ALTER TABLE "time_export_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_export_files" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_export_files_tenant_isolation" ON "time_export_files";
CREATE POLICY "time_export_files_tenant_isolation" ON "time_export_files"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- The runtime roles only read the bytes (download); the worker (owner)
-- inserts and deletes them.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('GRANT SELECT ON "time_export_files" TO %I', runtime_role);
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "time_export_files" FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE "time_export_files" IS
  'TIM-006: bytes of a ready background time export, deleted at expiry (TIME_EXPORT_FILE_TTL_HOURS, 7 days by default).';

-- The worker's dispatch sweep: ids of queued exports across organizations,
-- oldest first, and nothing else (no requester, period or format). It is the
-- worker's only cross-tenant read of this table; the job then reads and
-- updates its row through withTenant. Pattern of 0035: owned by and
-- executable only by librehr_owner, search_path pinned, names qualified.
CREATE OR REPLACE FUNCTION public.librehr_queued_time_exports(p_limit integer)
RETURNS TABLE (export_id uuid, organization_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  previous text := current_setting('librehr.export_dispatch', true);
BEGIN
  PERFORM set_config('librehr.export_dispatch', 'on', true);
  RETURN QUERY
    SELECT t.id, t.organization_id
    FROM public.time_exports t
    WHERE t.status = 'queued'
    ORDER BY t.created_at, t.id
    LIMIT least(greatest(coalesce(p_limit, 0), 0), 500);
  PERFORM set_config('librehr.export_dispatch', coalesce(previous, ''), true);
END
$$;

REVOKE ALL ON FUNCTION public.librehr_queued_time_exports(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_app') THEN
    REVOKE ALL ON FUNCTION public.librehr_queued_time_exports(integer) FROM librehr_app;
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'librehr_owner') THEN
    -- When migrations run as another role (e.g. the bootstrap superuser on
    -- an older install), hand the function and the dispatch policy to the
    -- worker's role (see 0020). A no-op when librehr_owner runs migrations.
    IF current_user <> 'librehr_owner'
       AND pg_catalog.pg_has_role(current_user, 'librehr_owner', 'MEMBER') THEN
      ALTER FUNCTION public.librehr_queued_time_exports(integer) OWNER TO librehr_owner;
    END IF;
    ALTER POLICY "time_exports_dispatch" ON "time_exports" TO librehr_owner;
    GRANT EXECUTE ON FUNCTION public.librehr_queued_time_exports(integer) TO librehr_owner;
  END IF;
END $$;

COMMENT ON TABLE "time_exports" IS
  'TIM-006: background organization time exports (outbox and issued-export record). The file expires after a TTL; the row is kept >= 4 years.';
