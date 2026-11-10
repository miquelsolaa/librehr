import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedProfile } from "./support/mock-api";
import {
  AXE_TAGS,
  EMPLOYEE_ID,
  EXPORT_ID,
  REPORT_ID,
  mockJsonExport,
  mockPicker,
} from "./support/time-export";

// TIM-006 / TIM-008: the export's employee picker reloads with the period.
// Fictional fixtures only.
const ALEX = { id: EMPLOYEE_ID, name: "Alex Example" };
const BLAKE = { id: REPORT_ID, name: "Blake Sample" };

test("a date change that drops the selected employee resets to own record and says so", async ({
  page,
}) => {
  await seedProfile(page, { role: "auditor" });
  const exportRequests: URL[] = [];
  await mockJsonExport(page, exportRequests);
  // Blake is not employed in February.
  await mockPicker(page, (query) =>
    query.get("startDate")?.startsWith("2026-02") ? [ALEX] : [ALEX, BLAKE],
  );

  await page.goto("/en/time/export");
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-01-31");
  const picker = page.getByLabel("Employee", { exact: true });
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: "Blake Sample" });

  await page.getByLabel("End date").fill("2026-02-28");
  await page.getByLabel("Start date").fill("2026-02-01");

  await expect(page.locator("main").getByRole("status")).toHaveText(
    "The selected employee isn’t employed in this period; the export now covers your own record.",
  );
  await expect(picker).toHaveValue("");
  await expect(picker.getByRole("option")).toHaveText([
    "Myself",
    "Alex Example",
  ]);

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("export-receipt-id")).toHaveText(EXPORT_ID);
  expect(exportRequests).toHaveLength(1);
  expect(exportRequests[0]?.searchParams.has("employeeId")).toBe(false);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("a failed reload clears the list and the choice and shows the hint", async ({
  page,
}) => {
  await seedProfile(page, { role: "manager" });
  const exportRequests: URL[] = [];
  await mockJsonExport(page, exportRequests);
  let calls = 0;
  // The first load works; every reload after a date change fails.
  await mockPicker(page, () => (calls++ === 0 ? [ALEX, BLAKE] : null));

  await page.goto("/en/time/export");
  const picker = page.getByLabel("Employee", { exact: true });
  await expect(
    picker.getByRole("option", { name: "Alex Example" }),
  ).toBeAttached();
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: "Alex Example" });

  await page.getByLabel("End date").fill("2026-01-31");
  await page.getByLabel("Start date").fill("2026-01-01");

  await expect(page.locator("#export-directory-hint")).toHaveText(
    "The employee list could not be loaded, so only your own record can be selected.",
  );
  await expect(picker.getByRole("option")).toHaveText(["Myself"]);
  await expect(picker).toHaveValue("");
  await expect(page.getByRole("button", { name: "Preview" })).toBeEnabled();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("export-receipt-id")).toHaveText(EXPORT_ID);
  expect(exportRequests[0]?.searchParams.has("employeeId")).toBe(false);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});
