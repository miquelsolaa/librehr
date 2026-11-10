import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// App shell (A11Y-001, DESIGN.md §3): grouped navigation, one account menu
// for identity, language, theme and sign-out, and a brand on the mobile bar.

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function mockOrganization(page: Page): Promise<void> {
  await mockRoute(page, "**/v1/org", (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Example Coop",
        slug: "example-coop",
        defaultLocale: "ca",
        timezone: "Europe/Madrid",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  );
}

test("admins see navigation grouped into Me and Organization", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The sidebar is desktop-only");
  await seedProfile(page, { role: "admin", name: "Sample Person" });
  await page.goto("/en/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const me = nav.getByRole("list", { name: "Me" });
  const organization = nav.getByRole("list", { name: "Organization" });
  await expect(me.getByRole("link", { name: "Time off" })).toBeVisible();
  await expect(
    organization.getByRole("link", { name: "People" }),
  ).toBeVisible();
  await expect(
    organization.getByRole("link", { name: "Settings" }),
  ).toBeVisible();
  await expect(page.locator("aside")).not.toContainText("Workspace");
});

test("employees see one unlabelled list", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is desktop-only");
  await seedProfile(page, { role: "employee", name: "Sample Person" });
  await page.goto("/en/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Documents" })).toBeVisible();
  await expect(nav.getByText("Organization", { exact: true })).toHaveCount(0);
  await expect(nav.getByText("Me", { exact: true })).toHaveCount(0);
});

test("the account menu shows the translated role and closes with Escape", async ({
  page,
}) => {
  await seedProfile(page, { role: "admin", name: "Sample Person" });
  await page.goto("/ca/home");
  const trigger = page.getByRole("button", { name: "Menú del compte" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Sample Person");
  await expect(menu).toContainText("Administrador");
  await expect(menu).not.toContainText("admin");
  // While the menu is open Radix hides the rest of the page (modal menu), so
  // scan the menu itself; the page is covered by a11y.spec.ts.
  const results = await new AxeBuilder({ page })
    .include("[role=menu]")
    .withTags(WCAG_TAGS)
    .analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the account menu switches language and theme", async ({ page }) => {
  await seedProfile(page, { role: "employee", name: "Sample Person" });
  await page.goto("/ca/home");
  await page.getByRole("button", { name: "Menú del compte" }).click();
  await page.getByRole("menuitemradio", { name: "Fosc" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Menú del compte" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Català" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/home$/);
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toBeVisible();
});

test("the mobile top bar shows the organization brand", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The sidebar carries the brand on desktop");
  await seedProfile(page, { role: "employee", name: "Sample Person" });
  await mockOrganization(page);
  await page.goto("/en/time-off");
  const brand = page.getByRole("banner").getByRole("link", {
    name: "Example Coop",
  });
  await expect(brand).toBeVisible();
  await expect(brand).toHaveAttribute("href", "/en/home");
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toBeVisible();
});
