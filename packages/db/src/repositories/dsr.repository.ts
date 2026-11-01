import type { TenantTx } from "../with-tenant.js";
import { EmployeeRepository } from "./employee.repository.js";
import { LeaveRepository } from "./leave.repository.js";
import { TimeRepository } from "./time.repository.js";
import { DocumentRepository } from "./document.repository.js";

export interface DataSubjectExportDump {
  exportedAt: string;
  employee: unknown;
  leaveSummary: {
    balance: unknown;
    ledgerEntries: unknown[];
    requests: unknown[];
  };
  timeRecords: unknown[];
  documents: unknown[];
}

/**
 * Aggregates all personal data, contracts, leave history, time records, and documents
 * for a data subject request under GDPR Art. 15 / 20 (ADM-004).
 */
export class DsrRepository {
  private empRepo = new EmployeeRepository();
  private leaveRepo = new LeaveRepository();
  private timeRepo = new TimeRepository();
  private docRepo = new DocumentRepository();

  async exportEmployeeData(
    tx: TenantTx,
    employeeId: string,
  ): Promise<DataSubjectExportDump | null> {
    const employee = await this.empRepo.findById(tx, employeeId);
    if (!employee) return null;

    const [balance, ledgerEntries, leaveRequests, timeEvents, documents] =
      await Promise.all([
        this.leaveRepo.calculateBalance(tx, employeeId),
        this.leaveRepo.getLedgerEntries(tx, employeeId),
        this.leaveRepo.getLeaveRequests(tx, { employeeId }),
        this.timeRepo.getEventsForEmployee(tx, employeeId),
        this.docRepo.list(tx, { employeeId }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      employee,
      leaveSummary: {
        balance,
        ledgerEntries,
        requests: leaveRequests,
      },
      timeRecords: timeEvents,
      documents,
    };
  }
}
