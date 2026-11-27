import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// ORG-007 (ADR 0008 decision 8): admins choose what leads of departments,
// projects and areas see of their members, on Settings -> Security.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000004";

async function mockSettingsApi(
  page: Page,
  options: { failPatch: () => boolean },
): Promise<{ patches: unknown[] }> {
  const patches: unknown[] = [];
  let current = {
    requireTwoFactor: false,
    auditorAccessMaxDays: 90,
    secondaryLeadVisibility: "calendar",
  };
  await mockRoute(page, "**/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/v1/settings/security") {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as Record<string, unknown>;
        patches.push(body);
        if (options.failPatch())
          return route.fulfill({
            status: 503,
            json: { type: "about:blank", title: "Unavailable", status: 503 },
          });
        current = { ...current, ...body };
      }
      return route.fulfill({ json: current });
    }
    if (pathname === "/v1/me")
      return route.fulfill({
        json: {
          user: {
            id: USER_ID,
            email: "sample@example.invalid",
            name: "Sample Admin",
            role: "admin",
            organizationId: ORG_ID,
            twoFactorEnabled: false,
          },
          organization: {
            id: ORG_ID,
            name: "Example Org",
            slug: "example-org",
            defaultLocale: "en",
            timezone: "Europe/Madrid",
            requireTwoFactor: false,
          },
          permissions: [],
        },
      });
    if (pathname === "/v1/notifications")
      return route.fulfill({ json: { items: [], unreadCount: 0 } });
    return route.fulfill({
      status: 404,
      json: { type: "about:blank", title: "Not Found", status: 404 },
    });
  });
  return { patches };
}

test.beforeEach(async ({ page }) => {
  await seedProfile(page, {
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "admin",
  });
});

test("an admin changes what leads see and is told when saving fails", async ({
  page,
}) => {
  let failing = true;
  const { patches } = await mockSettingsApi(page, {
    failPatch: () => failing,
  });
  await page.goto("/en/settings/security");
  const select = page.getByLabel("What leads see of their members");
  await expect(select).toHaveValue("calendar");
  await expect(select).toBeEnabled();
  await expect(select.locator("option")).toHaveText([
    "Nothing beyond their role",
    "Absences in the team calendar, without their type",
    "Absences and the directory profile",
  ]);

  await select.selectOption("profile");
  await expect(page.getByRole("alert")).toBeVisible();
  // The stored value is still shown after a failed save.
  await expect(select).toHaveValue("calendar");
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);

  failing = false;
  await select.selectOption("off");
  await expect(page.getByRole("status")).toBeVisible();
  await expect(select).toHaveValue("off");
  expect(patches).toEqual([
    { secondaryLeadVisibility: "profile" },
    { secondaryLeadVisibility: "off" },
  ]);
});
