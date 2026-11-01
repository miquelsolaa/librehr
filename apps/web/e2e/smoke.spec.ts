import { test, expect } from "@playwright/test";

test.describe("OpenHR Web Shell Smoke Tests", () => {
  test("loads the application shell at /ca/home in Catalan by default", async ({
    page,
  }) => {
    await page.goto("/ca/home");
    await expect(page).toHaveTitle(/OpenHR/);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("can view and interact with sign-in form", async ({ page }) => {
    await page.goto("/ca/sign-in");
    await expect(page.locator("input[name='email']")).toBeVisible();
    await expect(page.locator("input[name='password']")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toBeVisible();
  });

  test("renders desktop layout at 1280px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/ca/home");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
  });

  test("renders responsive mobile bottom navigation at 360px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/ca/home");
    const bottomNav = page.locator("nav[aria-label='Mobile Navigation']");
    await expect(bottomNav).toBeVisible();
  });
});
