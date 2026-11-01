import { describe, it, expect } from "vitest";
import {
  validateDocumentFile,
  matchBulkPayslips,
  computeChecklistTaskDueDates,
  validateEmployeeCsv,
} from "../src/index.js";

describe("M4 Pure Domain Logic: Documents & Lifecycle", () => {
  describe("Document Validation & Sanitization (DOC-004)", () => {
    it("allows valid PDF documents under size limit and sanitizes path traversal", () => {
      const res = validateDocumentFile(
        "../../malicious/path/contract_2026.pdf",
        "application/pdf",
        1024 * 500, // 500 KB
      );
      expect(res.valid).toBe(true);
      expect(res.sanitizedFilename).toBe("contract_2026.pdf");
    });

    it("rejects disallowed MIME types", () => {
      const res = validateDocumentFile("script.sh", "application/x-sh", 1024);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Unsupported file type");
    });

    it("rejects files exceeding the 15 MB limit", () => {
      const res = validateDocumentFile(
        "giant.pdf",
        "application/pdf",
        20 * 1024 * 1024,
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain("15 MB limit");
    });
  });

  describe("Bulk Payslip Matching (DOC-005)", () => {
    const employees = [
      {
        id: "emp-1",
        firstName: "Carles",
        lastName: "Puig",
        nationalId: "12345678Z",
        email: "cpuig@openhr.test",
      },
      {
        id: "emp-2",
        firstName: "Laura",
        lastName: "Sole",
        nationalId: "87654321X",
        email: "lsole@openhr.test",
      },
    ];

    it("matches payslips by national ID and extracts pay period", () => {
      const report = matchBulkPayslips(
        [
          "nomina_12345678Z_2026-05.pdf",
          "payslip_lsole_2026-05.pdf",
          "unknown.pdf",
        ],
        employees,
      );

      expect(report.totalFiles).toBe(3);
      expect(report.matchedCount).toBe(2);
      expect(report.unmatchedCount).toBe(1);

      expect(report.matches[0]?.matchedEmployeeId).toBe("emp-1");
      expect(report.matches[0]?.periodYearMonth).toBe("2026-05");
      expect(report.matches[1]?.matchedEmployeeId).toBe("emp-2");
      expect(report.matches[2]?.status).toBe("unmatched");
    });
  });

  describe("Checklist Task Scheduling (ONB-001, ONB-002)", () => {
    it("computes concrete due dates relative to base date and flags overdue tasks", () => {
      const tasks = [
        {
          title: "Sign contract",
          assignedRole: "employee" as const,
          dueOffsetDays: -3,
        },
        {
          title: "Welcome tour",
          assignedRole: "manager" as const,
          dueOffsetDays: 0,
        },
        {
          title: "1-month check-in",
          assignedRole: "manager" as const,
          dueOffsetDays: 30,
        },
      ];

      const computed = computeChecklistTaskDueDates(
        tasks,
        "2026-11-10",
        "2026-11-09", // Current date: -3 days (Nov 7) is overdue, Nov 10 & Dec 10 are not
      );

      expect(computed[0]?.dueDate).toBe("2026-11-07");
      expect(computed[0]?.isOverdue).toBe(true);

      expect(computed[1]?.dueDate).toBe("2026-11-10");
      expect(computed[1]?.isOverdue).toBe(false);

      expect(computed[2]?.dueDate).toBe("2026-12-10");
      expect(computed[2]?.isOverdue).toBe(false);
    });
  });

  describe("Employee Bulk Import CSV Validation (EMP-006)", () => {
    it("validates well-formed CSV data with Spanish IDs and IBANs", () => {
      const csv = `firstName,lastName,email,nationalId,jobTitle,startDate
Marta,Garcia,marta@openhr.test,12345678Z,Engineer,2026-01-15
Pau,Roca,pau@openhr.test,87654321X,Designer,2026-02-01`;

      const result = validateEmployeeCsv(csv);
      expect(result.valid).toBe(true);
      expect(result.totalRows).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.parsedRows[0]?.firstName).toBe("Marta");
    });

    it("rejects CSV with validation errors without partial application", () => {
      const csv = `firstName,lastName,email,nationalId
Marta,Garcia,not-an-email,00000000A`;

      const result = validateEmployeeCsv(csv);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.parsedRows).toHaveLength(0); // Atomic: never partially applies
    });
  });
});
