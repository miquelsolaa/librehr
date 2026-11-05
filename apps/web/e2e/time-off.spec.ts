import { test, expect } from "@playwright/test";

test.describe("Time Off & Leave Management E2E", () => {
  test("asks signed-out users to sign in", async ({ page }) => {
    await page.goto("/en/time-off");
    await expect(
      page.getByText("Sign in to view your time off."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
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
