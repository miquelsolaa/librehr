import type { TenantTx } from "../with-tenant.js";
import { decryptEnvelope } from "../crypto/envelope.js";
import {
  EmployeeRepository,
  type EmployeeProfile,
} from "./employee.repository.js";
import { LeaveRepository } from "./leave.repository.js";
import { TimeRepository } from "./time.repository.js";
import { DocumentRepository } from "./document.repository.js";

export interface DataSubjectExportDump {
  exportedAt: string;
  employee: DataSubjectEmployee;
  leaveSummary: {
    balance: unknown;
    ledgerEntries: unknown[];
    requests: unknown[];
  };
  timeRecords: unknown[];
  documents: unknown[];
}

/**
 * The employee record as the data subject sees it: sensitive fields decrypted
 * (it is their own data, GDPR art. 15), and no ciphertext, key material or
 * credential hashes.
 */
export type DataSubjectEmployee = Omit<
  EmployeeProfile,
  | "nationalIdEncrypted"
  | "ibanEncrypted"
  | "pinHash"
  | "pinSalt"
  | "hasNationalId"
  | "hasIban"
> & {
  nationalId: string | null;
  iban: string | null;
};

/** Decrypts the envelope-encrypted fields and drops every secret column. */
export function toDataSubjectEmployee(
  employee: EmployeeProfile,
): DataSubjectEmployee {
  const {
    nationalIdEncrypted,
    ibanEncrypted,
    pinHash: _pinHash,
    pinSalt: _pinSalt,
    hasNationalId: _hasNationalId,
    hasIban: _hasIban,
    ...rest
  } = employee;
  return {
    ...rest,
    nationalId: nationalIdEncrypted
      ? decryptEnvelope(nationalIdEncrypted)
      : null,
    iban: ibanEncrypted ? decryptEnvelope(ibanEncrypted) : null,
  };
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
        // Soft-deleted documents are still held until purged, so they are
        // part of what the subject is entitled to see (marked by deletedAt).
        this.docRepo.list(tx, { employeeId, includeDeleted: true }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      employee: toDataSubjectEmployee(employee),
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
