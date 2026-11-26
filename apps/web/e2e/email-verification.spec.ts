import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// AUTH-001: verify-email page and the unverified-address banner. The API is
// mocked; apps/api/test/email-verification.int.test.ts covers the server.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TOKEN = "sample-verification-token-0123456789abcdef";

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function mockMe(page: Page, emailVerified: boolean): Promise<void> {
  await mockRoute(page, "**/v1/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "00000000-0000-4000-8000-000000000002",
          email: "sample@example.invalid",
          name: "Sample Person",
          role: "admin",
          organizationId: "00000000-0000-4000-8000-000000000001",
        },
        organization: {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Example Coop",
          slug: "example-coop",
          defaultLocale: "ca",
          timezone: "Europe/Madrid",
        },
        permissions: [],
        emailVerified,
      },
    }),
  );
}

test.describe("email verification (AUTH-001)", () => {
  test("confirms the address from the emailed link", async ({ page }) => {
    let submitted: unknown;
    await mockRoute(
      page,
      "**/v1/auth/email-verification/confirm",
      async (route) => {
        submitted = route.request().postDataJSON();
        await route.fulfill({ status: 200, json: { success: true } });
      },
    );

    await page.goto(`/en/verify-email#token=${TOKEN}`);
    await expect(
      page.getByRole("heading", { name: "Confirm your email address" }),
    ).toBeVisible();
    // The token is removed from the address bar once read.
    await expect(page).toHaveURL(/\/en\/verify-email$/);
    // Opening the link alone spends nothing: a click confirms.
    expect(submitted).toBeUndefined();
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Confirm email address" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Your email address is confirmed.",
    );
    expect(submitted).toEqual({ token: TOKEN });
    await expect(
      page.getByRole("link", { name: "Go to LibreHR" }),
    ).toBeVisible();
  });

  test("explains an invalid, used or expired link", async ({ page }) => {
    await mockRoute(
      page,
      "**/v1/auth/email-verification/confirm",
      async (route) => {
        await route.fulfill({
          status: 400,
          contentType: "application/problem+json",
          json: {
            type: "about:blank",
            title: "Validation Error",
            status: 400,
            code: "VERIFICATION_TOKEN_INVALID",
          },
        });
      },
    );

    await page.goto(`/en/verify-email#token=${TOKEN}`);
    await page.getByRole("button", { name: "Confirm email address" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "invalid, already used or expired" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("treats a visit without a token as an invalid link", async ({
    page,
  }) => {
    await page.goto("/en/verify-email");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "invalid, already used or expired" }),
    ).toBeVisible();
  });

  test("an unverified user sees the banner and can ask for a new link", async ({
    page,
  }) => {
    let submitted: unknown;
    await seedProfile(page, { role: "admin", name: "Sample Person" });
    await mockMe(page, false);
    await mockRoute(page, "**/v1/auth/email-verification", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 202, json: { success: true } });
    });

    await page.goto("/en/home");
    const banner = page.getByRole("region", {
      name: "Confirm your email address",
    });
    await expect(banner).toBeVisible();
    await expectNoAxeViolations(page);

    await banner.getByRole("button", { name: "Send a new link" }).click();
    await expect(banner.getByRole("status")).toContainText(
      "A new confirmation link is on its way",
    );
    expect(submitted).toEqual({ locale: "en" });
  });

  test("the banner says when the server cannot send email", async ({
    page,
  }) => {
    await seedProfile(page, { role: "admin", name: "Sample Person" });
    await mockMe(page, false);
    await mockRoute(page, "**/v1/auth/email-verification", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: {
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          code: "EMAIL_UNAVAILABLE",
        },
      });
    });

    await page.goto("/en/home");
    const banner = page.getByRole("region", {
      name: "Confirm your email address",
    });
    await banner.getByRole("button", { name: "Send a new link" }).click();
    await expect(banner.getByRole("status")).toContainText(
      "cannot send email yet",
    );
  });

  test("a verified user sees no banner", async ({ page }) => {
    await seedProfile(page, { role: "admin", name: "Sample Person" });
    await mockMe(page, true);
    const meLoaded = page.waitForResponse("**/v1/me");
    await page.goto("/en/home");
    await meLoaded;
    await expect(
      page.getByRole("heading", { name: "Confirm your email address" }),
    ).toHaveCount(0);
  });
});
