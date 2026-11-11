import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockRoute } from "./support/mock-api";
import { AXE_TAGS } from "./support/time-export";

// LIC-003: Business features explain that they need LibreHR Business.

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
});

test("SSO settings explain that a Business licence is required", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/sso/config", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      json: {
        type: "urn:librehr:problem:license-required",
        title: "Forbidden",
        status: 403,
        code: "LICENSE_REQUIRED",
      },
    }),
  );
  await page.goto("/en/settings/sso");
  await expect(
    page.getByRole("status").filter({ hasText: "part of LibreHR Business" }),
  ).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("SSO settings still report a disabled instance when licensed", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/sso/config", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      json: {
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "SSO_DISABLED",
      },
    }),
  );
  await page.goto("/en/settings/sso");
  await expect(
    page.getByText("Single sign-on is not available on this instance yet."),
  ).toBeVisible();
  await expect(page.getByText("part of LibreHR Business")).toHaveCount(0);
});

test("settings marks SSO as a Business feature", async ({ page }) => {
  await page.goto("/en/settings");
  const ssoCard = page.getByRole("link", { name: /Single Sign-On \(SSO\)/ });
  await expect(ssoCard.getByText("Business", { exact: true })).toBeVisible();
});

// LIC-003: what was stored while licensed stays readable, and can be
// switched off, after the licence lapses.
const storedConfig = {
  id: "5a000000-0000-4000-8000-000000000001",
  organizationId: "5a000000-0000-4000-8000-000000000002",
  provider: "generic_oidc",
  clientId: "sample-client",
  issuerUrl: "https://idp.example.invalid",
  enabled: true,
  enforceSso: true,
  allowedDomains: ["example.invalid"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function mockUnlicensedWithStoredConfig(
  page: import("@playwright/test").Page,
) {
  await mockRoute(page, "**/v1/sso/config", (route) =>
    route.fulfill({ status: 200, json: storedConfig }),
  );
  await mockRoute(page, "**/v1/edition", (route) =>
    route.fulfill({
      status: 200,
      json: { edition: "community", licenseStatus: "expired", features: [] },
    }),
  );
}

test("a lapsed licence still shows the stored SSO settings and lets an admin switch them off", async ({
  page,
}) => {
  await mockUnlicensedWithStoredConfig(page);
  let disableCalls = 0;
  await mockRoute(page, "**/v1/sso/config/disable", (route) => {
    disableCalls += 1;
    return route.fulfill({
      status: 200,
      json: { ...storedConfig, enabled: false, enforceSso: false },
    });
  });
  await page.goto("/en/settings/sso");

  await expect(
    page.getByRole("status").filter({ hasText: "part of LibreHR Business" }),
  ).toBeVisible();
  const stored = page.getByRole("region", { name: "Stored configuration" });
  await expect(stored.getByText("sample-client")).toBeVisible();
  await expect(stored.getByText("Switched on")).toBeVisible();
  // The edit form is not offered without a licence.
  await expect(page.getByRole("button", { name: /save/i })).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);

  await stored
    .getByRole("button", { name: "Switch off single sign-on" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("The stored configuration is kept.");
  await dialog
    .getByRole("button", { name: "Switch off single sign-on" })
    .click();

  await expect(stored.getByText("Switched off")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "is switched off" }),
  ).toBeVisible();
  await expect(
    stored.getByRole("button", { name: "Switch off single sign-on" }),
  ).toHaveCount(0);
  expect(disableCalls).toBe(1);
});

test("a failed switch-off is reported and leaves the stored settings on", async ({
  page,
}) => {
  await mockUnlicensedWithStoredConfig(page);
  await mockRoute(page, "**/v1/sso/config/disable", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      json: { title: "Internal Server Error", status: 500 },
    }),
  );
  await page.goto("/en/settings/sso");
  const stored = page.getByRole("region", { name: "Stored configuration" });
  await stored
    .getByRole("button", { name: "Switch off single sign-on" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Switch off single sign-on" })
    .click();

  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be switched off",
  );
  await expect(stored.getByText("Switched on")).toBeVisible();
});
