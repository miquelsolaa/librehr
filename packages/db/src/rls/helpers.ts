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
  "time_events",
  "audit_log",
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

export function isTenantTable(tableName: string): boolean {
  return (TENANT_TABLES as readonly string[]).includes(tableName);
}
