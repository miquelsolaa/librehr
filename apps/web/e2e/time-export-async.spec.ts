import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";
import {
  AXE_TAGS,
  CONTENT_HASH,
  EXPORT_ID,
  SYNC_EXPORT_URL,
  mockPicker,
} from "./support/time-export";

// TIM-006, issue #38: organization exports too large for the request run in
// the background. Fictional fixtures only.
const BOM = String.fromCharCode(0xfeff);

function job(status: string, extra: Record<string, unknown> = {}) {
  return {
    exportId: EXPORT_ID,
    status,
    scope: "organization",
    format: "csv",
    locale: "es",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    employeeDays: 73_000,
    contentHash: null,
    employeeCount: null,
    byteSize: null,
    errorCode: null,
    createdAt: "2027-01-02T09:00:00.000Z",
    completedAt: null,
    expiresAt: null,
    ...extra,
  };
}

const READY = {
  contentHash: CONTENT_HASH,
  employeeCount: 200,
  byteSize: 1_024,
  completedAt: "2027-01-02T09:05:00.000Z",
  expiresAt: "2027-01-09T09:05:00.000Z",
};

test("admin generates a too-large organization export in the background and downloads it", async ({
  page,
}) => {
  await seedProfile(page, { role: "admin" });
  await mockRoute(page, SYNC_EXPORT_URL, (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Export Too Large",
        status: 422,
        code: "EXPORT_TOO_LARGE",
        asyncAvailable: true,
        employeeDays: 73_000,
      }),
    }),
  );
  await mockPicker(page, []);
  let created: unknown = null;
  let listCalls = 0;
  await mockRoute(page, "**/v1/time/exports", (route) => {
    if (route.request().method() === "POST") {
      created = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: job("queued") });
    }
    listCalls++;
    // Empty before the request, queued on the first poll, then ready.
    const items =
      created === null
        ? []
        : listCalls < 3
          ? [job("running")]
          : [job("ready", READY)];
    return route.fulfill({ json: { items } });
  });
  await mockRoute(page, "**/v1/time/exports/*/download", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      headers: {
        "x-export-id": EXPORT_ID,
        "x-content-sha256": CONTENT_HASH,
        "content-disposition":
          'attachment; filename="registro-jornada-2026-01-01-2026-12-31.csv"',
      },
      body: `${BOM}Empleado;Fecha\n# sha256=${CONTENT_HASH}\n`,
    }),
  );

  await page.goto("/en/time/export");
  await expect(page.getByText("You have no background exports.")).toBeVisible();
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-12-31");
  await page.getByLabel("Document language").selectOption("es");
  await page.getByLabel("Who to export").selectOption("organization");
  await page.getByRole("button", { name: "Download CSV" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "This export is too large to generate now. You can generate it in the background below.",
  );
  await page
    .getByRole("button", { name: "Generate CSV in the background" })
    .click();
  expect(created).toEqual({
    format: "csv",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    locale: "es",
  });
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  const row = page.getByTestId("export-job");
  await expect(row).toContainText("Queued");

  // Polled with backoff until the worker has finished.
  const download = row.getByRole("button", { name: "Download" });
  await expect(download).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("Available until");

  const downloadPromise = page.waitForEvent("download");
  await download.click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "registro-jornada-2026-01-01-2026-12-31.csv",
  );
  await expect(page.getByTestId("export-receipt-id")).toHaveText(EXPORT_ID);
  await expect(page.getByTestId("export-receipt-hash")).toHaveText(
    CONTENT_HASH,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("an expired background export opened from its notification says so", async ({
  page,
}) => {
  await seedProfile(page, { role: "auditor" });
  await mockPicker(page, []);
  await mockRoute(page, "**/v1/time/exports", (route) =>
    route.fulfill({ json: { items: [job("ready", READY)] } }),
  );
  await mockRoute(page, "**/v1/time/exports/*/download", (route) =>
    route.fulfill({
      status: 410,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Gone",
        status: 410,
        code: "EXPORT_EXPIRED",
      }),
    }),
  );

  await page.goto(`/en/time/export?job=${EXPORT_ID}`);
  const row = page.getByTestId("export-job");
  await expect(row).toHaveAttribute("aria-current", "true");
  await row.getByRole("button", { name: "Download" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "This download has expired and the file was deleted. Generate the export again.",
  );
  await expect(page.getByTestId("export-receipt-id")).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("a failed background export says why, so the requester knows what to change", async ({
  page,
}) => {
  await seedProfile(page, { role: "admin" });
  await mockPicker(page, []);
  await mockRoute(page, "**/v1/time/exports", (route) =>
    route.fulfill({
      json: {
        items: [
          job("failed", {
            errorCode: "EXPORT_TOO_LARGE",
            completedAt: "2027-01-02T09:05:00.000Z",
          }),
        ],
      },
    }),
  );

  await page.goto("/en/time/export");
  const row = page.getByTestId("export-job");
  await expect(row).toContainText("Failed");
  await expect(row.getByTestId("export-job-failure")).toHaveText(
    "The file is too large. Request a shorter period.",
  );
  await expect(row.getByRole("button", { name: "Download" })).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("employees are not offered background exports", async ({ page }) => {
  await seedProfile(page, { role: "employee" });
  let jobCalls = 0;
  await mockRoute(page, "**/v1/time/exports**", (route) => {
    jobCalls++;
    return route.fulfill({ status: 403, json: {} });
  });

  await page.goto("/en/time/export");
  await expect(
    page.getByRole("heading", { name: "Official Labour Inspection Export" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Background exports" }),
  ).toHaveCount(0);
  expect(jobCalls).toBe(0);
});
