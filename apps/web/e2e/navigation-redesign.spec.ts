import { expect, test } from "@playwright/test";

test("mobile navigation offers all destinations in a keyboard-operable menu", async ({
  page,
}) => {
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
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/en/time-off/calendar");
  const nav = page.getByRole("navigation", { name: /mobile navigation/i });
  await expect(nav.getByRole("link", { name: "Time off" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Time tracking" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Documents" })).toBeVisible();
  const more = nav.getByRole("button", { name: "More" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
});

test("navigation does not invent a user or organization when no session exists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/en/home");
  const sidebar = page.locator("aside");
  await expect(sidebar).not.toContainText("Marta Soler");
  await expect(sidebar).not.toContainText("Acme Serveis");
  await expect(sidebar).not.toContainText("Admin");
});

test("employee navigation excludes administrative modules", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "employee",
        token: "sample",
      }),
    ),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/en/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Time off" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
});
