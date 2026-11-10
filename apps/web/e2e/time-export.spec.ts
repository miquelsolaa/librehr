import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";
import {
  AXE_TAGS,
  CONTENT_HASH,
  EMPLOYEE_ID,
  EXPORT_ID,
  REPORT_ID,
  mockJsonExport,
  mockPicker,
} from "./support/time-export";

// TIM-006: official working-time export screen. Fictional fixtures only.
// The API starts CSVs with a byte-order mark.
const BOM = String.fromCharCode(0xfeff);

test("admin downloads the whole organization as CSV and sees its id and hash", async ({
  page,
}) => {
  await seedProfile(page, { role: "admin" });
  const exportRequests: URL[] = [];
  await mockRoute(page, "**/v1/time/export**", (route) => {
    exportRequests.push(new URL(route.request().url()));
    return route.fulfill({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      headers: {
        "x-export-id": EXPORT_ID,
        "x-content-sha256": CONTENT_HASH,
        "content-disposition":
          'attachment; filename="registro-jornada-2026-01-01-2026-01-31.csv"',
      },
      body: `${BOM}Empleado;Fecha\n# sha256=${CONTENT_HASH}\n`,
    });
  });
  await mockPicker(page, [{ id: EMPLOYEE_ID, name: "Alex Example" }]);

  await page.goto("/en/time/export");
  await expect(
    page
      .getByLabel("Employee", { exact: true })
      .getByRole("option", { name: "Alex Example" }),
  ).toBeAttached();
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-01-31");
  await page.getByLabel("Document language").selectOption("es");
  await page.getByLabel("Who to export").selectOption("organization");
  // Organization scope covers everyone: no employee to pick.
  await expect(page.getByLabel("Employee", { exact: true })).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(
    "registro-jornada-2026-01-01-2026-01-31.csv",
  );
  const query = exportRequests[0]?.searchParams;
  expect(query?.get("format")).toBe("csv");
  expect(query?.get("scope")).toBe("organization");
  expect(query?.get("locale")).toBe("es");
  expect(query?.get("startDate")).toBe("2026-01-01");
  expect(query?.get("endDate")).toBe("2026-01-31");
  expect(query?.has("employeeId")).toBe(false);

  await expect(page.locator("main").getByRole("status")).toContainText(
    "Downloaded registro-jornada-2026-01-01-2026-01-31.csv.",
  );
  await expect(page.getByTestId("export-receipt-id")).toHaveText(EXPORT_ID);
  await expect(page.getByTestId("export-receipt-hash")).toHaveText(
    CONTENT_HASH,
  );
  await expect(
    page.getByRole("button", { name: "Copy Export ID" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("employee sees a specific message when the export is forbidden", async ({
  page,
}) => {
  await seedProfile(page, { role: "employee" });
  await mockRoute(page, "**/v1/time/export**", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Forbidden",
        status: 403,
      }),
    }),
  );

  await page.goto("/en/time/export");
  await expect(
    page.getByRole("heading", { name: "Official Labour Inspection Export" }),
  ).toBeVisible();
  // Employees export only their own record.
  await expect(page.getByLabel("Who to export")).toHaveCount(0);
  await expect(page.getByLabel("Employee", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "You do not have permission to export this record. You can export your own record and, if you manage a team, your direct reports’.",
  );
  await expect(page.getByTestId("export-receipt-id")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview" })).toBeEnabled();
  // No horizontal page scroll, down to the 360 px mobile project.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("auditor picks one employee and previews their record", async ({
  page,
}) => {
  await seedProfile(page, { role: "auditor" });
  const exportRequests: URL[] = [];
  await mockJsonExport(page, exportRequests);
  const pickerRequests: URL[] = [];
  await mockPicker(
    page,
    [
      { id: EMPLOYEE_ID, name: "Alex Example" },
      { id: REPORT_ID, name: "Blake Sample" },
    ],
    pickerRequests,
  );

  await page.goto("/en/time/export");
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-01-31");
  await expect
    .poll(() => pickerRequests.at(-1)?.searchParams.get("endDate"))
    .toBe("2026-01-31");
  expect(pickerRequests.at(-1)?.searchParams.get("startDate")).toBe(
    "2026-01-01",
  );
  await page
    .getByLabel("Employee", { exact: true })
    .selectOption({ label: "Alex Example" });
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.getByTestId("export-receipt-id")).toHaveText(EXPORT_ID);
  const query = exportRequests[0]?.searchParams;
  expect(query?.get("employeeId")).toBe(EMPLOYEE_ID);
  expect(query?.get("scope")).toBe("employee");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("manager's picker lists only what the API returns for their scope", async ({
  page,
}) => {
  await seedProfile(page, { role: "manager" });
  let directoryCalls = 0;
  await mockRoute(page, "**/v1/employees**", (route) => {
    directoryCalls++;
    return route.fulfill({ status: 403, json: {} });
  });
  await mockPicker(page, [
    { id: EMPLOYEE_ID, name: "Alex Example" },
    { id: REPORT_ID, name: "Blake Sample" },
  ]);

  await page.goto("/en/time/export");
  const picker = page.getByLabel("Employee", { exact: true });
  await expect(
    picker.getByRole("option", { name: "Blake Sample" }),
  ).toBeAttached();
  await expect(picker.getByRole("option")).toHaveText([
    "Myself",
    "Alex Example",
    "Blake Sample",
  ]);
  // Managers export people, never the whole organization.
  await expect(page.getByLabel("Who to export")).toHaveCount(0);
  await expect(page.locator("#export-directory-hint")).toHaveCount(0);
  expect(directoryCalls).toBe(0);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});
