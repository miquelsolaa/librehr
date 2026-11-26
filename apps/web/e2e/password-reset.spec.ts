import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

// AUTH-001: forgot-password and reset-password pages. The API is mocked;
// apps/api/test/password-reset.int.test.ts covers the server side.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TOKEN = "sample-reset-token-0123456789abcdef";

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("password reset (AUTH-001)", () => {
  test("links from sign-in and asks for a link without revealing accounts", async ({
    page,
  }) => {
    let submitted: unknown;
    await mockRoute(page, "**/v1/auth/password-reset", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 202, json: { success: true } });
    });

    await page.goto("/en/sign-in");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page).toHaveURL(/\/en\/forgot-password$/);
    await expect(
      page.getByRole("heading", { name: "Reset your password" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByLabel("Email address").fill("someone@example.invalid");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByRole("status")).toContainText(
      "a reset link is on its way",
    );
    expect(submitted).toEqual({
      email: "someone@example.invalid",
      locale: "en",
    });
  });

  test("sets a new password from the emailed link", async ({ page }) => {
    let submitted: unknown;
    await mockRoute(
      page,
      "**/v1/auth/password-reset/confirm",
      async (route) => {
        submitted = route.request().postDataJSON();
        await route.fulfill({ status: 200, json: { success: true } });
      },
    );

    await page.goto(`/en/reset-password#token=${TOKEN}`);
    await expect(
      page.getByRole("heading", { name: "Choose a new password" }),
    ).toBeVisible();
    // The token is removed from the address bar once read.
    await expect(page).toHaveURL(/\/en\/reset-password$/);
    await expectNoAxeViolations(page);

    await page.locator("#new-password").fill("new-sample-password");
    await page
      .getByLabel("Repeat the new password")
      .fill("new-sample-password");
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(page.getByRole("status")).toContainText(
      "Your password has been changed",
    );
    expect(submitted).toEqual({
      token: TOKEN,
      password: "new-sample-password",
    });
    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test("checks that both passwords match before sending", async ({ page }) => {
    let called = false;
    await mockRoute(
      page,
      "**/v1/auth/password-reset/confirm",
      async (route) => {
        called = true;
        await route.fulfill({ status: 200, json: { success: true } });
      },
    );

    await page.goto(`/en/reset-password#token=${TOKEN}`);
    await page.locator("#new-password").fill("new-sample-password");
    await page.getByLabel("Repeat the new password").fill("different-password");
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "The two passwords do not match." }),
    ).toBeVisible();
    expect(called).toBe(false);
  });

  test("offers a new link when the link is expired or used", async ({
    page,
  }) => {
    await mockRoute(
      page,
      "**/v1/auth/password-reset/confirm",
      async (route) => {
        await route.fulfill({
          status: 400,
          contentType: "application/problem+json",
          json: {
            type: "about:blank",
            title: "Validation Error",
            status: 400,
            code: "RESET_TOKEN_INVALID",
          },
        });
      },
    );

    await page.goto(`/en/reset-password#token=${TOKEN}`);
    await page.locator("#new-password").fill("new-sample-password");
    await page
      .getByLabel("Repeat the new password")
      .fill("new-sample-password");
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "invalid, already used or expired" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole("link", { name: "Ask for a new link" }).click();
    await expect(page).toHaveURL(/\/en\/forgot-password$/);
  });

  test("treats a malformed token as an invalid link, not a password error", async ({
    page,
  }) => {
    await mockRoute(
      page,
      "**/v1/auth/password-reset/confirm",
      async (route) => {
        await route.fulfill({
          status: 400,
          contentType: "application/problem+json",
          json: {
            type: "about:blank",
            title: "Validation Error",
            status: 400,
            code: "VALIDATION_ERROR",
            errors: [{ field: "token", message: "Too small" }],
          },
        });
      },
    );
    await page.goto("/en/reset-password#token=short");
    await page.locator("#new-password").fill("new-sample-password");
    await page
      .getByLabel("Repeat the new password")
      .fill("new-sample-password");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "invalid, already used or expired" }),
    ).toBeVisible();
  });

  test("treats a visit without a token as an invalid link", async ({
    page,
  }) => {
    await page.goto("/en/reset-password");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "invalid, already used or expired" }),
    ).toBeVisible();
  });
});
