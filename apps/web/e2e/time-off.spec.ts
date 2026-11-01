import { test, expect } from "@playwright/test";

test.describe("Time Off & Leave Management E2E", () => {
  test("renders time off balance summary cards and request action", async ({
    page,
  }) => {
    await page.goto("/en/time-off");

    // Title & headers
    await expect(page.locator("h1")).toContainText("Time Off & Leave");

    // Balance summary cards
    await expect(page.getByText("Remaining Balance")).toBeVisible();
    await expect(page.getByText("Total Accrued")).toBeVisible();
    await expect(page.getByText("Used to Date")).toBeVisible();

    // Action buttons
    const requestBtn = page.getByRole("link", { name: "Request Time Off" });
    await expect(requestBtn).toBeVisible();

    const calendarBtn = page.getByRole("link", {
      name: "Team Absence Calendar",
    });
    await expect(calendarBtn).toBeVisible();
  });

  test("navigates to request leave form and verifies form fields", async ({
    page,
  }) => {
    await page.goto("/en/time-off/request");

    await expect(page.locator("h1")).toContainText("New Time Off Request");
    await expect(page.getByText("Start Date")).toBeVisible();
    await expect(page.getByText("End Date")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit Request" }),
    ).toBeVisible();
  });

  test("navigates to team absence calendar", async ({ page }) => {
    await page.goto("/en/time-off/calendar");

    await expect(page.locator("h1")).toContainText("Team Schedule & Absences");
    await expect(page.getByText("Scheduled Absences")).toBeVisible();
  });
});
