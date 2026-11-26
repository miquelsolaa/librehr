import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute } from "./support/mock-api";
import { AXE_TAGS } from "./support/time-export";

// AUTH-004 "Require SSO" (issue #180). The API is mocked;
// apps/api/test/sso-enforcement.int.test.ts and sso.int.test.ts cover the
// server side.

const ssoRequired = {
  type: "about:blank",
  title: "Forbidden",
  status: 403,
  code: "SSO_REQUIRED",
  detail: "This organization requires single sign-on",
};

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function signIn(page: Page, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("sample-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe("sign-in when the organization requires SSO", () => {
  test("explains it and opens the SSO prompt for the email's domain", async ({
    page,
  }) => {
    await mockRoute(page, "**/v1/auth/sign-in", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/problem+json",
        json: ssoRequired,
      }),
    );
    await signIn(page, "someone@example.invalid");

    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Your organization signs in with single sign-on",
    );
    await expect(page.getByLabel("Corporate domain or email")).toHaveValue(
      "example.invalid",
    );
    await expect(
      page.getByRole("button", { name: "Continue with SSO" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("still reports a wrong password as invalid credentials", async ({
    page,
  }) => {
    await mockRoute(page, "**/v1/auth/sign-in", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        json: {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          code: "INVALID_CREDENTIALS",
        },
      }),
    );
    await signIn(page, "someone@example.invalid");

    await expect(page.locator("main").getByRole("alert")).toContainText(
      "The email or password provided is incorrect.",
    );
    await expect(page.getByLabel("Corporate domain or email")).toHaveCount(0);
  });

  test("an accepted invitation into such an organization continues with SSO", async ({
    page,
  }) => {
    await mockRoute(page, "**/v1/invitations/accept", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/problem+json",
        json: ssoRequired,
      }),
    );
    await mockRoute(page, "**/v1/invitations/sample-invite-token", (route) =>
      route.fulfill({
        status: 200,
        json: {
          email: "invitee@example.invalid",
          role: "employee",
          orgName: "Sample Org",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    );
    await page.goto("/en/invite/sample-invite-token");
    await page.getByLabel("Your full name").fill("Sample Person");
    await page.getByLabel("Create a password").fill("sample-password");
    await page.getByRole("button", { name: /Accept Invitation/ }).click();

    await expect(page).toHaveURL(/\/en\/sign-in\?sso=required$/);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Your organization signs in with single sign-on",
    );
    await expect(page.getByLabel("Corporate domain or email")).toBeVisible();
  });
});

test.describe("Require SSO setting", () => {
  const config = {
    id: "5a000000-0000-4000-8000-000000000001",
    organizationId: "5a000000-0000-4000-8000-000000000002",
    provider: "generic_oidc",
    clientId: "sample-client",
    issuerUrl: "https://idp.example.invalid",
    enabled: true,
    enforceSso: false,
    allowedDomains: ["example.invalid"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "librehr_auth_session",
        JSON.stringify({
          userId: "sample",
          organizationId: "sample",
          email: "sample@example.invalid",
          role: "admin",
          token: "sample",
        }),
      ),
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
  });

  async function requireSso(page: Page, answer: (body: unknown) => object) {
    const saved: unknown[] = [];
    await mockRoute(page, "**/v1/sso/config", async (route) => {
      if (route.request().method() === "POST") {
        const body: unknown = route.request().postDataJSON();
        saved.push(body);
        await route.fulfill(answer(body));
        return;
      }
      await route.fulfill({ status: 200, json: config });
    });
    await page.goto("/en/settings/sso");
    await expect(page.getByLabel("Client ID")).toHaveValue("sample-client");
    await page.getByLabel("Enforce Mandatory SSO").check();
    await page.getByRole("button", { name: "Save SSO Configuration" }).click();
    return saved;
  }

  test("asks for confirmation before requiring SSO", async ({ page }) => {
    const saved = await requireSso(page, () => ({
      status: 200,
      json: { ...config, enforceSso: true },
    }));

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Members without SSO will be signed out",
    );
    await expectNoAxeViolations(page);
    expect(saved).toHaveLength(0);

    await dialog.getByRole("button", { name: "Require SSO" }).click();
    await expect(page.getByRole("status")).toContainText(
      "SSO configuration saved successfully.",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ enforceSso: true, enabled: true });
  });

  test("explains that an admin with two-factor authentication is needed", async ({
    page,
  }) => {
    await requireSso(page, () => ({
      status: 409,
      contentType: "application/problem+json",
      json: {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "SSO_BREAK_GLASS_REQUIRED",
      },
    }));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Require SSO" })
      .click();

    await expect(page.locator("main").getByRole("alert")).toContainText(
      "At least one administrator needs two-factor authentication",
    );
    await expectNoAxeViolations(page);
  });
});
