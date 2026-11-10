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
