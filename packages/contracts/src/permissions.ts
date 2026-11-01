export const Scopes = [
  "self",
  "reports",
  "department",
  "location",
  "organization",
] as const;
export type Scope = (typeof Scopes)[number];

export const Permissions = [
  "org.read",
  "org.write",
  "employee.read",
  "employee.write",
  "employee.read_sensitive",
  "leave.request.create",
  "leave.request.read",
  "leave.request.approve",
  "time.clock",
  "time.record.read",
  "time.record.correct",
  "document.read",
  "document.write",
  "audit.read",
] as const;

export type Permission = (typeof Permissions)[number];

export interface ScopedPermission {
  permission: Permission;
  scope: Scope;
}

export const ROLE_PERMISSIONS: Record<string, readonly ScopedPermission[]> = {
  admin: [
    { permission: "org.read", scope: "organization" },
    { permission: "org.write", scope: "organization" },
    { permission: "employee.read", scope: "organization" },
    { permission: "employee.write", scope: "organization" },
    { permission: "employee.read_sensitive", scope: "organization" },
    { permission: "leave.request.create", scope: "organization" },
    { permission: "leave.request.read", scope: "organization" },
    { permission: "leave.request.approve", scope: "organization" },
    { permission: "time.clock", scope: "self" },
    { permission: "time.record.read", scope: "organization" },
    { permission: "time.record.correct", scope: "organization" },
    { permission: "document.read", scope: "organization" },
    { permission: "document.write", scope: "organization" },
    { permission: "audit.read", scope: "organization" },
  ],
  manager: [
    { permission: "org.read", scope: "organization" },
    { permission: "employee.read", scope: "reports" },
    { permission: "leave.request.create", scope: "self" },
    { permission: "leave.request.read", scope: "reports" },
    { permission: "leave.request.approve", scope: "reports" },
    { permission: "time.clock", scope: "self" },
    { permission: "time.record.read", scope: "reports" },
    { permission: "time.record.correct", scope: "reports" },
    { permission: "document.read", scope: "self" },
  ],
  employee: [
    { permission: "org.read", scope: "organization" },
    { permission: "employee.read", scope: "self" },
    { permission: "leave.request.create", scope: "self" },
    { permission: "leave.request.read", scope: "self" },
    { permission: "time.clock", scope: "self" },
    { permission: "time.record.read", scope: "self" },
    { permission: "document.read", scope: "self" },
  ],
  auditor: [
    { permission: "org.read", scope: "organization" },
    { permission: "time.record.read", scope: "organization" },
    { permission: "audit.read", scope: "organization" },
  ],
};
