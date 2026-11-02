/**
 * Context data available for document template merge field substitution.
 */
export interface TemplateMergeContext {
  employee?: {
    name?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    taxId?: string; // DNI / NIE
    jobTitle?: string;
    department?: string;
    hireDate?: string;
    salary?: string;
    address?: string;
  };
  organization?: {
    name?: string;
    taxId?: string; // CIF
    address?: string;
  };
  currentDate?: string;
  custom?: Record<string, string | number>;
}

/**
 * Extracts all unique `{{variable}}` placeholders present in a template string.
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{([a-zA-Z0-9_.-]+)\}\}/g);
  if (!matches) return [];
  const unique = new Set(
    matches.map((m) => m.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "")),
  );
  return Array.from(unique);
}

/**
 * Replaces `{{field.subfield}}` placeholders in a template with data from the merge context.
 * Unresolved fields are left unchanged or replaced with empty string if strict is false.
 */
export function renderDocumentTemplate(
  template: string,
  context: TemplateMergeContext,
  fallback = "[Missing Value]",
): string {
  const defaultDate =
    context.currentDate ?? new Date().toISOString().slice(0, 10);

  return template.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_, key: string) => {
      const trimmed = key.trim();

      if (trimmed === "current_date" || trimmed === "currentDate") {
        return defaultDate;
      }

      if (trimmed.startsWith("employee.")) {
        const field = trimmed.slice("employee.".length);
        const emp = context.employee;
        if (!emp) return fallback;

        switch (field) {
          case "name":
            return emp.name ?? fallback;
          case "firstName":
          case "first_name":
            return emp.firstName ?? fallback;
          case "lastName":
          case "last_name":
            return emp.lastName ?? fallback;
          case "email":
            return emp.email ?? fallback;
          case "dni":
          case "nie":
          case "taxId":
          case "tax_id":
            return emp.taxId ?? fallback;
          case "jobTitle":
          case "job_title":
          case "title":
            return emp.jobTitle ?? fallback;
          case "department":
            return emp.department ?? fallback;
          case "hireDate":
          case "hire_date":
            return emp.hireDate ?? fallback;
          case "salary":
            return emp.salary ?? fallback;
          case "address":
            return emp.address ?? fallback;
          default:
            return fallback;
        }
      }

      if (
        trimmed.startsWith("organization.") ||
        trimmed.startsWith("company.")
      ) {
        const field = trimmed.startsWith("organization.")
          ? trimmed.slice("organization.".length)
          : trimmed.slice("company.".length);
        const org = context.organization;
        if (!org) return fallback;

        switch (field) {
          case "name":
            return org.name ?? fallback;
          case "cif":
          case "taxId":
          case "tax_id":
            return org.taxId ?? fallback;
          case "address":
            return org.address ?? fallback;
          default:
            return fallback;
        }
      }

      if (trimmed.startsWith("custom.")) {
        const customKey = trimmed.slice("custom.".length);
        const val = context.custom?.[customKey];
        return val !== undefined ? String(val) : fallback;
      }

      // Direct custom keys
      if (context.custom && context.custom[trimmed] !== undefined) {
        return String(context.custom[trimmed]);
      }

      return fallback;
    },
  );
}
