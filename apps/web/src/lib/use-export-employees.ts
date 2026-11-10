import * as React from "react";
import type { ExportEmployeesResponse } from "@librehr/contracts";
import { getApiClient } from "@/lib/api-client";
import { isValidExportPeriod } from "@/lib/time-export";

export type PickerEmployee = ExportEmployeesResponse["items"][number];

/**
 * TIM-006: the employee picker of the official export. Lists whom the caller
 * may export for the period (time.record.read scope), not the employee
 * directory: an auditor has no employee.read. Reloads when the period
 * changes and drops a selection the new period no longer lists.
 */
export function useExportEmployees({
  enabled,
  startDate,
  endDate,
}: {
  enabled: boolean;
  startDate: string;
  endDate: string;
}) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [directory, setDirectory] = React.useState<PickerEmployee[]>([]);
  const [directoryFailed, setDirectoryFailed] = React.useState(false);
  const [directoryLoading, setDirectoryLoading] = React.useState(false);
  const [selectionReset, setSelectionReset] = React.useState(false);
  // Read when a reload lands, without reloading on every selection.
  const employeeIdRef = React.useRef(employeeId);
  employeeIdRef.current = employeeId;
  const periodValid = isValidExportPeriod(startDate, endDate);
  React.useEffect(() => {
    if (!enabled || !periodValid) {
      setDirectoryLoading(false);
      return;
    }
    let cancelled = false;
    setDirectoryLoading(true);
    getApiClient()
      .listExportEmployees({ startDate, endDate })
      .then(({ items }) => {
        if (cancelled) return;
        setDirectory(items);
        setDirectoryFailed(false);
        // Drop a choice the new period no longer lists: the select would show
        // "Myself" while the export still targeted the hidden employee.
        const id = employeeIdRef.current;
        if (id && !items.some((e) => e.id === id)) {
          setEmployeeId("");
          setSelectionReset(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Only the caller's own record is left, as the hint says.
        setDirectory([]);
        setEmployeeId("");
        setDirectoryFailed(true);
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, periodValid, startDate, endDate]);

  /** A choice made by the user, which also clears the reset notice. */
  const selectEmployee = React.useCallback((id: string) => {
    setEmployeeId(id);
    setSelectionReset(false);
  }, []);
  const clearSelectionReset = React.useCallback(
    () => setSelectionReset(false),
    [],
  );

  return {
    employeeId,
    selectEmployee,
    directory,
    directoryFailed,
    directoryLoading,
    selectionReset,
    clearSelectionReset,
  };
}
