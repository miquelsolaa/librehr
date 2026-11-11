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

test("managers see their own pages under Me and team pages under Organization", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The sidebar is desktop-only");
  await seedProfile(page, { role: "manager", name: "Sample Person" });
  await page.goto("/en/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("list", { name: "Me" }).getByRole("link"),
  ).toHaveText(["Home", "Time off", "Time tracking", "Documents"]);
  await expect(
    nav.getByRole("list", { name: "Organization" }).getByRole("link"),
  ).toHaveText(["People", "Onboarding", "Reports"]);
});

test("auditors see one unlabelled read-only list", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The sidebar is desktop-only");
  await seedProfile(page, { role: "auditor", name: "Sample Person" });
  await page.goto("/en/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link")).toHaveText([
    "Home",
    "Time tracking",
    "Inspection records",
    "Reports",
  ]);
  await expect(nav.getByText("Me", { exact: true })).toHaveCount(0);
});

test("on a short screen the menu scrolls so sign-out stays reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await seedProfile(page, { role: "employee", name: "Sample Person" });
  await page.goto("/en/home");
  await page.getByRole("button", { name: "Account menu" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // The menu fits the viewport and scrolls, instead of running off-screen.
  const box = await menu.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(360);
  expect(await menu.evaluate((el) => getComputedStyle(el).overflowY)).toBe(
    "auto",
  );
  const signOut = page.getByRole("menuitem", { name: "Sign out" });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
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
  await expect(menu).toHaveAccessibleDescription("Sample Person Administrador");
  await expect(menu.getByText("Administrador", { exact: true })).toBeVisible();
  await expect(menu.getByText("admin", { exact: true })).toHaveCount(0);
  await expect(
    menu.getByRole("group", { name: "Idioma" }).getByRole("menuitemradio"),
  ).toHaveCount(3);
  await expect(
    menu.getByRole("group", { name: "Tema" }).getByRole("menuitemradio"),
  ).toHaveCount(3);
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
