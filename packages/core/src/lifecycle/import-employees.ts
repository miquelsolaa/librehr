import { validateSpanishId } from "../identity/dni-nie.js";
import { validateIban } from "../identity/iban.js";

export interface EmployeeCsvRow {
  firstName: string;
  lastName: string;
  email: string;
  nationalId?: string | undefined;
  iban?: string | undefined;
  jobTitle?: string | undefined;
  departmentName?: string | undefined;
  startDate?: string | undefined;
}

export interface CsvValidationIssue {
  row: number;
  field: string;
  message: string;
}

export interface EmployeeImportValidationResult {
  valid: boolean;
  totalRows: number;
  validRowsCount: number;
  errors: CsvValidationIssue[];
  parsedRows: EmployeeCsvRow[];
}

/**
 * Validates a CSV string of employee records for bulk import (EMP-006).
 * Follows atomic validation: never partially applies if any row contains formatting errors.
 */
export function validateEmployeeCsv(
  csvContent: string,
): EmployeeImportValidationResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      valid: false,
      totalRows: 0,
      validRowsCount: 0,
      errors: [
        {
          row: 0,
          field: "csv",
          message: "CSV file is empty or missing data rows",
        },
      ],
      parsedRows: [],
    };
  }

  const headerLine = lines[0]!;
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());

  const fnIdx = headers.indexOf("firstname");
  const lnIdx = headers.indexOf("lastname");
  const emIdx = headers.indexOf("email");
  const nifIdx = headers.indexOf("nationalid");
  const ibanIdx = headers.indexOf("iban");
  const titleIdx = headers.indexOf("jobtitle");
  const deptIdx = headers.indexOf("department");
  const startIdx = headers.indexOf("startdate");

  if (fnIdx === -1 || lnIdx === -1 || emIdx === -1) {
    return {
      valid: false,
      totalRows: 0,
      validRowsCount: 0,
      errors: [
        {
          row: 1,
          field: "header",
          message:
            "CSV header must include 'firstName', 'lastName', and 'email'",
        },
      ],
      parsedRows: [],
    };
  }

  const errors: CsvValidationIssue[] = [];
  const parsedRows: EmployeeCsvRow[] = [];
  const seenEmails = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const cols = lines[i]!.split(",").map((c) => c.trim());

    const firstName = cols[fnIdx] ?? "";
    const lastName = cols[lnIdx] ?? "";
    const email = cols[emIdx]?.toLowerCase() ?? "";
    const nationalId = nifIdx !== -1 ? cols[nifIdx] : undefined;
    const iban = ibanIdx !== -1 ? cols[ibanIdx] : undefined;
    const jobTitle = titleIdx !== -1 ? cols[titleIdx] : undefined;
    const departmentName = deptIdx !== -1 ? cols[deptIdx] : undefined;
    const startDate = startIdx !== -1 ? cols[startIdx] : undefined;

    if (!firstName) {
      errors.push({
        row: rowNum,
        field: "firstName",
        message: "First name is required",
      });
    }
    if (!lastName) {
      errors.push({
        row: rowNum,
        field: "lastName",
        message: "Last name is required",
      });
    }
    if (!email || !email.includes("@")) {
      errors.push({
        row: rowNum,
        field: "email",
        message: "Valid email is required",
      });
    } else if (seenEmails.has(email)) {
      errors.push({
        row: rowNum,
        field: "email",
        message: `Duplicate email in CSV: ${email}`,
      });
    } else {
      seenEmails.add(email);
    }

    if (nationalId && !validateSpanishId(nationalId).valid) {
      errors.push({
        row: rowNum,
        field: "nationalId",
        message: "Invalid Spanish DNI/NIE format or control letter",
      });
    }

    if (iban && !validateIban(iban).valid) {
      errors.push({
        row: rowNum,
        field: "iban",
        message: "Invalid IBAN checksum or format",
      });
    }

    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      errors.push({
        row: rowNum,
        field: "startDate",
        message: "Start date must be YYYY-MM-DD",
      });
    }

    parsedRows.push({
      firstName,
      lastName,
      email,
      nationalId: nationalId || undefined,
      iban: iban || undefined,
      jobTitle: jobTitle || undefined,
      departmentName: departmentName || undefined,
      startDate: startDate || undefined,
    });
  }

  return {
    valid: errors.length === 0,
    totalRows: parsedRows.length,
    validRowsCount: errors.length === 0 ? parsedRows.length : 0,
    errors,
    parsedRows: errors.length === 0 ? parsedRows : [],
  };
}
