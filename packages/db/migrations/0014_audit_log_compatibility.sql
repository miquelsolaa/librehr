-- 0014_audit_log_compatibility.sql
-- Align audit_log table with AuditRepository expectations and tenant context

ALTER TABLE "audit_log"
  ALTER COLUMN "organization_id" SET DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  ALTER COLUMN "entity_type" DROP NOT NULL,
  ALTER COLUMN "hash" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "resource_type" text,
  ADD COLUMN IF NOT EXISTS "resource_id" text,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;
