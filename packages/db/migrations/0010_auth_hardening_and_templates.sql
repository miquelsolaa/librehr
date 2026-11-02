-- Migration 0010_auth_hardening_and_templates.sql
-- Enforced 2FA (AUTH-003), OIDC SSO (AUTH-004), Document Merge Templates (DOC-007)

-- 1. Add require_two_factor to organizations
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "require_two_factor" boolean NOT NULL DEFAULT false;

-- 2. Add 2FA fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_secret" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_recovery_codes" jsonb;

-- 3. Create sso_configurations table
CREATE TABLE IF NOT EXISTS "sso_configurations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "client_id" text NOT NULL,
  "client_secret" text NOT NULL,
  "issuer_url" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "enforce_sso" boolean NOT NULL DEFAULT false,
  "allowed_domains" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sso_configurations_org_idx" ON "sso_configurations"("organization_id");
CREATE INDEX IF NOT EXISTS "sso_configurations_provider_idx" ON "sso_configurations"("organization_id", "provider");

ALTER TABLE "sso_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_configurations" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "sso_configurations";
CREATE POLICY "tenant_isolation_policy" ON "sso_configurations"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 4. Create document_templates table
CREATE TABLE IF NOT EXISTS "document_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "description" text,
  "content" text NOT NULL,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "document_templates_org_idx" ON "document_templates"("organization_id");
CREATE INDEX IF NOT EXISTS "document_templates_category_idx" ON "document_templates"("organization_id", "category");

ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_templates" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "document_templates";
CREATE POLICY "tenant_isolation_policy" ON "document_templates"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
