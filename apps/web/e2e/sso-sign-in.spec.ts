import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";
import { AXE_TAGS } from "./support/time-export";

// AUTH-004: the web side of single sign-on. The API and the identity
// provider are mocked; apps/api/test/sso-callback.int.test.ts covers the
// callback itself.
const ORG_ID = "5a000000-0000-4000-8000-000000000002";
const USER_ID = "5a000000-0000-4000-8000-000000000003";
const IDP_AUTHORIZE = "https://idp.example.invalid/authorize";

const user = {
  id: USER_ID,
  email: "sample@example.invalid",
  name: "Sample Person",
  role: "employee",
  organizationId: ORG_ID,
};

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function storedProfile(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("librehr_auth_session") ?? "null"),
  );
}

test.describe("single sign-on (AUTH-004)", () => {
  test("signs in through the identity provider and lands on home", async ({
    page,
    baseURL,
  }) => {
    let authorizeBody: unknown;
    await mockRoute(page, "**/v1/sso/authorize", async (route) => {
      authorizeBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        json: { authorizationUrl: `${IDP_AUTHORIZE}?state=sample` },
      });
    });
    // The provider and the API callback end where the callback redirects.
    await page.route(`${IDP_AUTHORIZE}**`, (route) =>
      route.fulfill({
        status: 302,
        headers: { location: `${baseURL}/en/sso/complete` },
      }),
    );
    await mockRoute(page, "**/v1/me", (route) =>
      route.fulfill({
        status: 200,
        json: {
          user,
          organization: {
            id: ORG_ID,
            name: "Example Org",
            slug: "example",
            defaultLocale: "en",
            timezone: "Europe/Madrid",
          },
          permissions: [],
        },
      }),
    );

    await page.goto("/en/sign-in");
    await page
      .getByRole("button", { name: "Sign in with Company SSO" })
      .click();
    await page.getByLabel("Corporate domain or email").fill("example.invalid");
    await page.getByRole("button", { name: "Continue with SSO" }).click();

    await expect(page).toHaveURL(/\/en\/home$/);
    expect(authorizeBody).toEqual({ domain: "example.invalid", locale: "en" });
    expect(await storedProfile(page)).toEqual({
      userId: USER_ID,
      email: user.email,
      name: user.name,
      organizationId: ORG_ID,
      role: "employee",
    });
  });

  test("explains a refused sign-in and clears the code from the address", async ({
    page,
  }) => {
    await page.goto("/en/sign-in?sso_error=SSO_NO_ACCOUNT");
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "you have no LibreHR account in this organization",
    );
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await expectNoAxeViolations(page);
  });

  test("keeps state and token failures generic", async ({ page }) => {
    await page.goto("/en/sign-in?sso_error=SSO_TOKEN_INVALID");
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Single sign-on did not finish. Try again, or sign in with your email and password.",
    );
    await page.goto("/en/sign-in?sso_error=not-a-code");
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Single sign-on did not finish.",
    );
  });

  test("asks for the local 2FA code after the identity provider", async ({
    page,
  }) => {
    let verifyBody: unknown;
    await mockRoute(page, "**/v1/auth/2fa/verify", async (route) => {
      verifyBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        json: { user, expiresAt: "2030-01-01T00:00:00.000Z" },
      });
    });

    await page.goto("/en/sign-in#sso_challenge=sample-challenge");
    await expect(
      page.getByRole("heading", { name: "Two-Factor Authentication" }),
    ).toBeVisible();
    // The challenge is removed from the address bar once read.
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await expectNoAxeViolations(page);

    await page.getByLabel(/Authentication code/).fill("123456");
    await page.getByRole("button", { name: "Verify & Continue" }).click();
    await expect(page).toHaveURL(/\/en\/home$/);
    expect(verifyBody).toEqual({
      challengeToken: "sample-challenge",
      code: "123456",
    });
  });

  test("reports a session that cannot be read after the callback", async ({
    page,
  }) => {
    await mockRoute(page, "**/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        json: { title: "Unauthorized", status: 401, code: "UNAUTHORIZED" },
      }),
    );
    await page.goto("/en/sso/complete");
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Your sign-in could not be finished.",
    );
    await expectNoAxeViolations(page);
    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test("settings show the redirect URI the API sends", async ({ page }) => {
    await seedProfile(page, { role: "admin" });
    await mockRoute(page, "**/v1/sso/config", (route) =>
      route.fulfill({
        status: 200,
        json: {
          id: "5a000000-0000-4000-8000-000000000001",
          organizationId: ORG_ID,
          provider: "generic_oidc",
          clientId: "sample-client",
          issuerUrl: "https://idp.example.invalid",
          enabled: true,
          enforceSso: false,
          allowedDomains: ["example.invalid"],
          redirectUri: "https://api.example.invalid/v1/sso/callback",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    await mockRoute(page, "**/v1/edition", (route) =>
      route.fulfill({
        status: 200,
        json: {
          edition: "business",
          licenseStatus: "valid",
          features: ["sso"],
        },
      }),
    );

    await page.goto("/en/settings/sso");
    await expect(
      page.getByText("https://api.example.invalid/v1/sso/callback"),
    ).toBeVisible();
  });
});
