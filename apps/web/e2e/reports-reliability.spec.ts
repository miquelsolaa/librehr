import { expect, test } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

const summary = {
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  headcount: {
    startingHeadcount: 2,
    endingHeadcount: 3,
    joinersCount: 1,
    leaversCount: 0,
    netChange: 1,
    turnoverRatePercent: 0,
  },
  absences: {
    totalAbsentDays: 0,
    totalPlannedWorkingDays: 60,
    absenceRatePercent: 0,
    byCategory: {},
  },
};

test("signed-out reports do not show sample figures", async ({ page }) => {
  await page.goto("/en/reports");
  await expect(page.getByText("Sign in to view reports.")).toBeVisible();
  await expect(page.getByText("14", { exact: true })).toHaveCount(0);
});

test("unreliable report figures are not shown", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "admin",
        token: "sample",
      }),
    ),
  );
  await mockRoute(page, "**/v1/reports/summary", (route) =>
    route.fulfill({ json: summary }),
  );
  await page.goto("/en/reports");
  await expect(
    page.getByText(
      "Absence and overtime figures are unavailable while their source data is being corrected.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Active Headcount")).toHaveCount(0);
  await expect(page.getByText("3", { exact: true })).toHaveCount(0);
});

test("export explains why it is unavailable", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "admin",
        token: "sample",
      }),
    ),
  );
  await page.goto("/en/reports");
  await expect(
    page.getByText(
      "The export is unavailable while its source data is being corrected.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download Payroll CSV" }),
  ).toHaveCount(0);
});

test("administrators can request a scoped headcount report", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "admin",
        token: "sample",
      }),
    ),
  );
  await mockRoute(page, "**/v1/reports/headcount?**", (route) =>
    route.fulfill({
      json: {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        headcount: summary.headcount,
      },
    }),
  );
  await page.goto("/en/reports");
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-12-31");
  await page.getByRole("button", { name: "Show headcount" }).click();
  await expect(page.getByText("Ending headcount")).toBeVisible();
  await expect(page.getByText("3", { exact: true })).toBeVisible();
});

test("headcount errors are visible and do not display figures", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "admin",
        token: "sample",
      }),
    ),
  );
  await mockRoute(page, "**/v1/reports/headcount?**", (route) =>
    route.fulfill({ status: 409 }),
  );
  await page.goto("/en/reports");
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-12-31");
  await page.getByRole("button", { name: "Show headcount" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be loaded",
  );
  await expect(page.getByText("Ending headcount")).toHaveCount(0);
});

test("headcount CSV download reports an export failure without hiding the report", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "admin",
        token: "sample",
      }),
    ),
  );
  await mockRoute(page, "**/v1/reports/headcount?**", (route) =>
    route.fulfill({
      json: {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        headcount: summary.headcount,
      },
    }),
  );
  await mockRoute(page, "**/v1/reports/headcount/export?**", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/en/reports");
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-12-31");
  await page.getByRole("button", { name: "Show headcount" }).click();
  await page.getByRole("button", { name: "Download headcount CSV" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be downloaded",
  );
  await expect(page.getByText("Ending headcount")).toBeVisible();
});

test("headcount CSV can be downloaded", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "admin",
        token: "sample",
      }),
    ),
  );
  await mockRoute(page, "**/v1/reports/headcount?**", (route) =>
    route.fulfill({
      json: {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        headcount: summary.headcount,
      },
    }),
  );
  await mockRoute(page, "**/v1/reports/headcount/export?**", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: "headcount\r\n3\r\n",
    }),
  );
  await page.goto("/en/reports");
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-12-31");
  await page.getByRole("button", { name: "Show headcount" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download headcount CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(
    "headcount-2026-01-01-2026-12-31.csv",
  );
  expect(await download.failure()).toBeNull();
});
