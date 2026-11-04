import { test, expect } from "@playwright/test";

test.describe("Insights, Gestoria & Tokens E2E (M5)", () => {
  test("renders reports dashboard with KPIs and Gestoría export section", async ({
    page,
  }) => {
    await page.goto("/en/reports");

    await expect(page.locator("h1")).toContainText("HR Insights & Reports");
    await expect(
      page.getByText("Active Headcount", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Turnover Rate", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Absence Rate", { exact: true })).toBeVisible();

    // Gestoría export
    await expect(
      page.getByRole("heading", { name: "Gestoría Payroll Export" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download Payroll CSV" }),
    ).toBeVisible();

    // iCal feed
    await expect(
      page.getByRole("heading", { name: "iCalendar Subscription Feed" }),
    ).toBeVisible();
  });

  test("loads personal access tokens page and opens creation modal", async ({
    page,
  }) => {
    await page.goto("/en/settings/tokens");

    await expect(page.locator("h1")).toContainText("Personal Access Tokens");

    const createBtn = page.getByRole("button", { name: "Generate New Token" });
    await expect(createBtn).toBeVisible();

    await createBtn.click();
    await expect(page.getByLabel("Token Name")).toBeVisible();
    await expect(page.getByText("Permissions / Scopes")).toBeVisible();
  });
});
