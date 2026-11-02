// Tenant tables that have organization_id column
export const TENANT_TABLES = [
  "legal_entities",
  "locations",
  "departments",
  "memberships",
  "invitations",
  "employees",
  "employments",
  "leave_ledger",
  "leave_types",
  "leave_policies",
  "leave_policy_assignments",
  "holiday_calendars",
  "holidays",
  "leave_requests",
  "notifications",
  "time_events",
  "schedules",
  "schedule_rules",
  "employee_schedules",
  "time_corrections",
  "documents",
  "document_versions",
  "document_acknowledgements",
  "checklist_templates",
  "checklist_template_tasks",
  "checklist_instances",
  "checklist_tasks",
  "audit_log",
  "personal_access_tokens",
  "teams",
  "custom_field_definitions",
  "custom_field_values",
  "emergency_contacts",
  "time_bank_records",
  "blackout_periods",
  "approval_delegations",
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

export function isTenantTable(tableName: string): boolean {
  return (TENANT_TABLES as readonly string[]).includes(tableName);
}
