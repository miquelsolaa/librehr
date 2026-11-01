-- Migration 0003: Time Off & Notifications (M2)

-- 1. leave_types
CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "is_paid" boolean DEFAULT true NOT NULL,
  "requires_approval" boolean DEFAULT true NOT NULL,
  "half_days_allowed" boolean DEFAULT true NOT NULL,
  "counts_working_days" boolean DEFAULT true NOT NULL,
  "color" text DEFAULT '#3b82f6' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "leave_types_org_idx" ON "leave_types" ("organization_id");
CREATE INDEX IF NOT EXISTS "leave_types_code_idx" ON "leave_types" ("organization_id", "code");

ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_types_tenant_isolation" ON "leave_types";
CREATE POLICY "leave_types_tenant_isolation" ON "leave_types"
  AS RESTRICTIVE
  USING ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 2. leave_policies
CREATE TABLE IF NOT EXISTS "leave_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "annual_allowance_days" numeric(5, 2) DEFAULT 22.00 NOT NULL,
  "accrual_method" text DEFAULT 'monthly' NOT NULL,
  "carryover_max_days" numeric(5, 2) DEFAULT 5.00 NOT NULL,
  "carryover_expiry_months" integer DEFAULT 3 NOT NULL,
  "allow_negative_balance" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "leave_policies_org_idx" ON "leave_policies" ("organization_id");
CREATE INDEX IF NOT EXISTS "leave_policies_type_idx" ON "leave_policies" ("leave_type_id");

ALTER TABLE "leave_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_policies_tenant_isolation" ON "leave_policies";
CREATE POLICY "leave_policies_tenant_isolation" ON "leave_policies"
  AS RESTRICTIVE
  USING ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 3. leave_policy_assignments
CREATE TABLE IF NOT EXISTS "leave_policy_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "leave_policy_id" uuid NOT NULL REFERENCES "leave_policies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "effective_from" date NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "leave_policy_assignments_org_idx" ON "leave_policy_assignments" ("organization_id");
CREATE INDEX IF NOT EXISTS "leave_policy_assignments_emp_idx" ON "leave_policy_assignments" ("employee_id");

ALTER TABLE "leave_policy_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policy_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_policy_assignments_tenant_isolation" ON "leave_policy_assignments";
CREATE POLICY "leave_policy_assignments_tenant_isolation" ON "leave_policy_assignments"
  AS RESTRICTIVE
  USING ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 4. holiday_calendars
CREATE TABLE IF NOT EXISTS "holiday_calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "year" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "holiday_calendars_org_loc_year_idx" ON "holiday_calendars" ("organization_id", "location_id", "year");

ALTER TABLE "holiday_calendars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holiday_calendars" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "holiday_calendars_tenant_isolation" ON "holiday_calendars";
CREATE POLICY "holiday_calendars_tenant_isolation" ON "holiday_calendars"
  AS RESTRICTIVE
  USING ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 5. holidays
CREATE TABLE IF NOT EXISTS "holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "calendar_id" uuid NOT NULL REFERENCES "holiday_calendars"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "name" text NOT NULL,
  "scope" text DEFAULT 'national' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "holidays_calendar_idx" ON "holidays" ("calendar_id");
CREATE INDEX IF NOT EXISTS "holidays_date_idx" ON "holidays" ("organization_id", "date");

ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holidays" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "holidays_tenant_isolation" ON "holidays";
CREATE POLICY "holidays_tenant_isolation" ON "holidays"
  AS RESTRICTIVE
  USING ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 6. leave_requests
CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "half_day_start" boolean DEFAULT false NOT NULL,
  "half_day_end" boolean DEFAULT false NOT NULL,
  "working_days" numeric(5, 2) NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "notes" text,
  "approver_id" uuid REFERENCES "employees"("id"),
  "decided_at" timestamptz,
  "decision_reason" text,
  "reversal_ledger_entry_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "leave_requests_org_idx" ON "leave_requests" ("organization_id");
CREATE INDEX IF NOT EXISTS "leave_requests_emp_idx" ON "leave_requests" ("employee_id");
CREATE INDEX IF NOT EXISTS "leave_requests_dates_idx" ON "leave_requests" ("organization_id", "start_date", "end_date");

ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_requests_tenant_isolation" ON "leave_requests";
CREATE POLICY "leave_requests_tenant_isolation" ON "leave_requests"
  AS RESTRICTIVE
  USING ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 7. notifications
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "category" text NOT NULL,
  "link" text,
  "read" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notifications_org_user_idx" ON "notifications" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "notifications_read_idx" ON "notifications" ("user_id", "read");

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_tenant_isolation" ON "notifications";
CREATE POLICY "notifications_tenant_isolation" ON "notifications"
  AS RESTRICTIVE
  USING ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);
