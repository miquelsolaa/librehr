import type { Page } from "@playwright/test";
import { mockRoute } from "./mock-api";

// TIM-006 export screen fixtures shared by the time-export specs. Fictional.
export const EXPORT_ID = "00000000-0000-4000-8000-0000000000e1";
export const CONTENT_HASH = "a".repeat(64);
export const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
export const REPORT_ID = "00000000-0000-4000-8000-000000000003";
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export interface PickerItem {
  id: string;
  name: string;
}

/**
 * Mocks the export's employee picker. `items` may depend on the request's
 * query; `null` answers 500. Register it after any `**\/v1/time/export**`
 * mock: the last matching route wins, and that glob also matches the picker.
 */
export async function mockPicker(
  page: Page,
  items: PickerItem[] | ((query: URLSearchParams) => PickerItem[] | null),
  requests: URL[] = [],
): Promise<void> {
  await mockRoute(page, "**/v1/time/export/employees**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const list = typeof items === "function" ? items(url.searchParams) : items;
    if (list === null) {
      return route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Error",
          status: 500,
        }),
      });
    }
    return route.fulfill({ json: { items: list } });
  });
}

/** Mocks a JSON (preview) export of one employee, recording each request. */
export async function mockJsonExport(
  page: Page,
  requests: URL[],
): Promise<void> {
  await mockRoute(page, "**/v1/time/export**", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({
      json: {
        exportId: EXPORT_ID,
        contentHash: CONTENT_HASH,
        scope: "employee",
        locale: "en",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        timeZone: "Europe/Madrid",
        generatedAt: "2026-02-01T09:00:00.000Z",
        organizationName: "Example Org",
        generatedBy: { name: "Ada Auditor", role: "auditor" },
        metadataLines: [],
        columns: ["Employee", "Date", "Employed"],
        // TIM-006: the second day is outside the employee's employment.
        rows: [
          ["Alex Example", "2026-01-02", "Yes"],
          ["Alex Example", "2026-01-03", "No"],
        ],
        rowsEmployed: [true, false],
        employees: [
          {
            employeeId: EMPLOYEE_ID,
            name: "Alex Example",
            timeZone: "Europe/Madrid",
            scheduleConfigured: true,
            chainStatus: "verified",
            totalWorkedMinutes: 480,
            totalOvertimeMinutes: 0,
          },
        ],
      },
    });
  });
}
