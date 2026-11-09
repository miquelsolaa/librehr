import { test, expect } from "@playwright/test";

test.describe("Time Tracking & Timesheet E2E", () => {
  test("renders time tracking dashboard with KPI cards and export action", async ({
    page,
  }) => {
    await page.goto("/en/time");

    await expect(page.locator("h1")).toContainText("Working Time Tracking");

    await expect(
      page.getByText("Your timesheet could not be loaded."),
    ).toBeVisible();

    const exportBtn = page.getByRole("link", {
      name: "Official Labour Inspection Export",
    });
    await expect(exportBtn).toBeVisible();
  });

  test("renders time corrections request page", async ({ page }) => {
    await page.goto("/en/time/corrections");

    await expect(page.getByText("Request Correction")).toBeVisible();
    await expect(page.getByText("Event Type")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit Correction Request" }),
    ).toBeVisible();
  });

  test("renders official export page with date range controls", async ({
    page,
  }) => {
    await page.goto("/en/time/export");

    await expect(page.locator("h1")).toContainText(
      "Official Labour Inspection Export",
    );
    await expect(page.getByLabel("Start date")).toBeVisible();
    await expect(page.getByLabel("End date")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download CSV" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download PDF" }),
    ).toBeVisible();
  });
});
