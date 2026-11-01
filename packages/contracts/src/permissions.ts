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
  "leave.request.create",
  "leave.request.approve",
  "time.clock",
  "time.record.read",
  "time.record.correct",
  "document.read",
  "document.write",
] as const;

export type Permission = (typeof Permissions)[number];
