import { can, permissionScope, type PolicyUserContext } from "./can.js";

/** Roles that may open other people's payslips (DOC-003). */
const PAYROLL_ROLES: ReadonlySet<string> = new Set(["payroll"]);

/** The access-relevant fields of a document row. */
export interface DocumentAccessFields {
  organizationId: string;
  employeeId: string | null;
  category: string;
  audienceType: string;
  targetDepartmentId: string | null;
  targetLocationId: string | null;
}

/** Whether a company-wide document targets the caller (DOC-002). */
export function isInDocumentAudience(
  ctx: PolicyUserContext,
  doc: DocumentAccessFields,
): boolean {
  if (doc.organizationId !== ctx.organizationId || doc.employeeId !== null) {
    return false;
  }
  switch (doc.audienceType) {
    case "company":
      return true;
    case "department":
      return (
        Boolean(ctx.departmentId) && ctx.departmentId === doc.targetDepartmentId
      );
    case "location":
      return Boolean(ctx.locationId) && ctx.locationId === doc.targetLocationId;
    default:
      return false;
  }
}

/**
 * Whether a document appears in listings. Same as content access, except that
 * HR/admin (organization-scoped `document.write`) also see payslip metadata so
 * they can manage uploads; opening a payslip still follows canReadDocument.
 */
export function canListDocument(
  ctx: PolicyUserContext,
  doc: DocumentAccessFields,
): boolean {
  if (canReadDocument(ctx, doc)) return true;
  return (
    doc.organizationId === ctx.organizationId &&
    permissionScope(ctx, "document.write") === "organization"
  );
}

/**
 * DOC-003 read access to a document's content:
 * - payslips: the employee they belong to and the payroll role only;
 * - personal documents: per `document.read` scope (employees and managers
 *   their own, HR/admin the organization). No document type currently lets
 *   managers open their reports' documents, so they are denied;
 * - company-wide documents: their audience, plus organization-scoped readers.
 * Personal documents are checked against the owner's employee id only, so a
 * reports-scoped `document.read` would fail closed until it is needed.
 */
export function canReadDocument(
  ctx: PolicyUserContext,
  doc: DocumentAccessFields,
): boolean {
  if (doc.organizationId !== ctx.organizationId) return false;
  const isOwner = doc.employeeId !== null && doc.employeeId === ctx.employeeId;
  if (doc.category === "payslips") {
    return isOwner || PAYROLL_ROLES.has(ctx.role);
  }
  if (doc.employeeId === null) {
    return (
      permissionScope(ctx, "document.read") === "organization" ||
      isInDocumentAudience(ctx, doc)
    );
  }
  return can(ctx, "document.read", {
    organizationId: doc.organizationId,
    employeeId: doc.employeeId,
  });
}
