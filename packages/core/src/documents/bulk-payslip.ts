export interface EmployeeIdentifier {
  id: string;
  nationalId?: string | undefined;
  email: string;
  firstName: string;
  lastName: string;
}

export interface PayslipMatchResult {
  filename: string;
  matchedEmployeeId: string | null;
  employeeName?: string | undefined;
  periodYearMonth?: string | undefined; // YYYY-MM
  status: "matched" | "unmatched" | "ambiguous";
  error?: string | undefined;
}

export interface BulkPayslipReport {
  totalFiles: number;
  matchedCount: number;
  unmatchedCount: number;
  matches: PayslipMatchResult[];
}

/**
 * Matches payslip files against employee identifiers (nationalId, email, or exact name)
 * for bulk upload dry-run and processing (DOC-005).
 */
export function matchBulkPayslips(
  filenames: string[],
  employees: EmployeeIdentifier[],
): BulkPayslipReport {
  const matches: PayslipMatchResult[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const filename of filenames) {
    const normalized = filename.toLowerCase();

    // Check for year-month pattern in filename (e.g., 2026-05 or 2026_05 or 202605)
    let periodYearMonth: string | undefined;
    const ymMatch = /(20\d{2})[-_]?(\d{2})/.exec(normalized);
    if (ymMatch?.[1] && ymMatch[2]) {
      periodYearMonth = `${ymMatch[1]}-${ymMatch[2]}`;
    }

    // Match candidate employees
    const candidates = employees.filter((emp) => {
      // 1. Match by national ID (DNI/NIE) if present
      if (emp.nationalId) {
        const cleanNif = emp.nationalId.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleanNif.length >= 8 && normalized.includes(cleanNif)) {
          return true;
        }
      }

      // 2. Match by email username (before @)
      const emailUser = emp.email.split("@")[0]?.toLowerCase();
      if (emailUser && emailUser.length > 3 && normalized.includes(emailUser)) {
        return true;
      }

      // 3. Match by lastName_firstName
      const namePattern = `${emp.lastName}_${emp.firstName}`.toLowerCase();
      if (namePattern.length > 5 && normalized.includes(namePattern)) {
        return true;
      }

      return false;
    });

    if (candidates.length === 1 && candidates[0]) {
      const emp = candidates[0];
      matchedCount++;
      matches.push({
        filename,
        matchedEmployeeId: emp.id,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        periodYearMonth,
        status: "matched",
      });
    } else if (candidates.length > 1) {
      unmatchedCount++;
      matches.push({
        filename,
        matchedEmployeeId: null,
        periodYearMonth,
        status: "ambiguous",
        error: `Matched multiple employees (${candidates.length})`,
      });
    } else {
      unmatchedCount++;
      matches.push({
        filename,
        matchedEmployeeId: null,
        periodYearMonth,
        status: "unmatched",
        error: "No matching employee identified",
      });
    }
  }

  return {
    totalFiles: filenames.length,
    matchedCount,
    unmatchedCount,
    matches,
  };
}
