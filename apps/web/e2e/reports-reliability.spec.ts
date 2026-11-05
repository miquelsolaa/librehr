import { expect, test } from "@playwright/test";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};
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
  await page.route("**/v1/reports/summary", (route) =>
    route.fulfill({ headers: cors, json: summary }),
  );
  await page.goto("/en/reports");
  await expect(
    page.getByText(
      "Report figures are unavailable while their source data is being corrected.",
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
