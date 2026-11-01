-- 0000_initial_schema.sql
-- Base schema for OpenHR Milestone M0

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Organizations (Platform aggregate)
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "default_locale" text NOT NULL DEFAULT 'ca',
  "timezone" text NOT NULL DEFAULT 'Europe/Madrid',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "organizations_slug_idx" ON "organizations" ("slug");

-- Legal Entities
CREATE TABLE IF NOT EXISTS "legal_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "tax_id" text NOT NULL,
  "country" text NOT NULL DEFAULT 'ES',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "legal_entities_org_idx" ON "legal_entities" ("organization_id");

-- Locations (Centros de trabajo)
CREATE TABLE IF NOT EXISTS "locations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "legal_entity_id" uuid REFERENCES "legal_entities"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "country" text NOT NULL DEFAULT 'ES',
  "region" text NOT NULL DEFAULT 'CT',
  "city" text NOT NULL,
  "timezone" text NOT NULL DEFAULT 'Europe/Madrid',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "locations_org_idx" ON "locations" ("organization_id");

-- Users (Identity aggregate)
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "password_hash" text,
  "email_verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

-- Sessions
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sessions_token_idx" ON "sessions" ("token");
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");

-- Memberships
CREATE TABLE IF NOT EXISTS "memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'employee',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "memberships_org_user_unique" UNIQUE ("organization_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "memberships_org_user_idx" ON "memberships" ("organization_id", "user_id");

-- Employees (People aggregate)
CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "preferred_name" text,
  "email" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "national_id_encrypted" text,
  "iban_encrypted" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "employees_org_idx" ON "employees" ("organization_id");
CREATE INDEX IF NOT EXISTS "employees_user_idx" ON "employees" ("user_id");

-- Employments with exclusion constraint against overlapping active periods
CREATE TABLE IF NOT EXISTS "employments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "job_title" text NOT NULL,
  "employment_type" text NOT NULL DEFAULT 'indefinido',
  "start_date" date NOT NULL,
  "end_date" date,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "no_overlapping_employments" EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') WITH &&
  )
);
CREATE INDEX IF NOT EXISTS "employments_org_idx" ON "employments" ("organization_id");
CREATE INDEX IF NOT EXISTS "employments_employee_idx" ON "employments" ("employee_id");

-- Leave Ledger (Append-only)
CREATE TABLE IF NOT EXISTS "leave_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "entry_type" text NOT NULL,
  "amount" numeric(5, 2) NOT NULL,
  "unit" text NOT NULL DEFAULT 'days',
  "source_ref" text,
  "note" text,
  "effective_date" date NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "leave_ledger_org_idx" ON "leave_ledger" ("organization_id");
CREATE INDEX IF NOT EXISTS "leave_ledger_employee_idx" ON "leave_ledger" ("employee_id");

-- Time Events (Append-only & hash-chained)
CREATE TABLE IF NOT EXISTS "time_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "source" text NOT NULL DEFAULT 'web',
  "actor_id" uuid NOT NULL,
  "ref_event_id" uuid REFERENCES "time_events"("id") ON DELETE SET NULL,
  "reason" text,
  "prev_hash" text,
  "hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "time_events_org_idx" ON "time_events" ("organization_id");
CREATE INDEX IF NOT EXISTS "time_events_employee_idx" ON "time_events" ("employee_id");
CREATE INDEX IF NOT EXISTS "time_events_occurred_idx" ON "time_events" ("occurred_at");

-- Audit Log (Append-only & hash-chained)
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "actor_id" uuid,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "details" jsonb,
  "ip_address" text,
  "user_agent" text,
  "prev_hash" text,
  "hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_log_org_idx" ON "audit_log" ("organization_id");
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "audit_log" ("created_at");
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" ("entity_type", "entity_id");
