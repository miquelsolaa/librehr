import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Accessibility & Privacy Boundary Tests", () => {
  test("home page passes axe accessibility scan", async ({ page }) => {
    await page.goto("/ca/home");
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("sign-in page passes axe accessibility scan", async ({ page }) => {
    await page.goto("/ca/sign-in");
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("makes zero third-party network requests (strict privacy)", async ({
    page,
  }) => {
    const thirdPartyRequests: string[] = [];

    page.on("request", (req) => {
      const url = new URL(req.url());
      if (
        url.hostname !== "localhost" &&
        url.hostname !== "127.0.0.1" &&
        url.protocol !== "data:" &&
        url.protocol !== "blob:"
      ) {
        thirdPartyRequests.push(req.url());
      }
    });

    await page.goto("/ca/home");
    await page.waitForLoadState("networkidle");

    expect(thirdPartyRequests).toEqual([]);
  });
});

test.describe("Redesigned employee screens", () => {
  for (const path of [
    "/en/time",
    "/en/time-off",
    "/en/people",
    "/en/people/org-chart",
    "/en/documents",
    "/en/onboarding",
    "/en/reports",
  ]) {
    test(`${path} passes axe while signed out`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
