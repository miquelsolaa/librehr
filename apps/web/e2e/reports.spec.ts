import { test, expect } from "@playwright/test";

test.describe("Insights, Gestoria & Tokens E2E (M5)", () => {
  test("requires sign-in to access reports", async ({ page }) => {
    await page.goto("/en/reports");
    await expect(page.locator("h1")).toContainText("HR Insights & Reports");
    await expect(page.getByText("Sign in to view reports.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
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
