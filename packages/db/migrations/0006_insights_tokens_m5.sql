-- Migration 0006_insights_tokens_m5.sql
-- Personal Access Tokens (ADM-006)

CREATE TABLE IF NOT EXISTS "personal_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "prefix" varchar(16) NOT NULL,
  "scopes" jsonb NOT NULL,
  "expires_at" timestamptz,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pat_org_idx" ON "personal_access_tokens"("organization_id");
CREATE INDEX IF NOT EXISTS "pat_user_idx" ON "personal_access_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "pat_token_hash_idx" ON "personal_access_tokens"("token_hash");

-- RLS
ALTER TABLE "personal_access_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_access_tokens" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON "personal_access_tokens";
CREATE POLICY "tenant_isolation_policy" ON "personal_access_tokens"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
