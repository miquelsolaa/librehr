import { test, expect, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// AUTH-001/002: the session lives only in the API's httpOnly cookie. The page
// never stores or sends a session token.

test("settings requests rely on the session cookie, never a Bearer token", async ({
  page,
}) => {
  // A profile left by an older version still holds a token: it must be
  // dropped, not sent.
  await seedProfile(page, { role: "admin", token: "legacy-token" });
  let authorization: string | undefined = "not-called";
  await mockRoute(page, "**/v1/org/departments", async (route) => {
    authorization = route.request().headers()["authorization"];
    await route.fulfill({ json: [] });
  });
  await page.goto("/en/settings/departments");
  await expect.poll(() => authorization).toBeUndefined();
  const stored = await page.evaluate(() =>
    localStorage.getItem("librehr_auth_session"),
  );
  expect(stored).not.toContain("legacy-token");
});

test("sign-in keeps no token in storage", async ({ page }) => {
  await mockRoute(page, "**/v1/auth/sign-in", async (route) => {
    await route.fulfill({
      headers: {
        "set-cookie":
          "librehr_session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=600",
      },
      json: {
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "sample@example.invalid",
          name: "Sample",
          role: "admin",
          organizationId: "00000000-0000-0000-0000-000000000002",
        },
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    });
  });
  await page.goto("/en/sign-in");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/home/);
  const stored = await page.evaluate(() =>
    localStorage.getItem("librehr_auth_session"),
  );
  expect(stored).toContain("sample@example.invalid");
  expect(stored).not.toContain("token");
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "librehr_session",
  );
});

test("sign-out revokes the session and returns to sign-in", async ({
  page,
}) => {
  await seedProfile(page, { role: "admin" });
  let signOutCalls = 0;
  await mockRoute(page, "**/v1/auth/sign-out", async (route) => {
    signOutCalls++;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto("/en/home");
  await clickSignOut(page);
  await expect(page).toHaveURL(/\/en\/sign-in/);
  expect(signOutCalls).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("librehr_auth_session")),
  ).toBeNull();
});

test("sign-out still clears the local profile when the API fails", async ({
  page,
}) => {
  await seedProfile(page, { role: "admin" });
  await mockRoute(page, "**/v1/auth/sign-out", async (route) => {
    await route.fulfill({ status: 500, body: "" });
  });
  await page.goto("/en/home");
  await clickSignOut(page);
  await expect(page).toHaveURL(/\/en\/sign-in/);
  expect(
    await page.evaluate(() => localStorage.getItem("librehr_auth_session")),
  ).toBeNull();
});

/** Sign-out lives in the account menu at every width. */
async function clickSignOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

test("employees on mobile sign out from the account menu with the keyboard", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Covers the mobile top bar");
  // Employees have no overflow links, so the bottom bar has no "More".
  await seedProfile(page, { role: "employee", name: "Sample Person" });
  let signOutCalls = 0;
  await mockRoute(page, "**/v1/auth/sign-out", async (route) => {
    signOutCalls++;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto("/ca/home");
  await expect(
    page
      .getByRole("navigation", { name: "Navegació mòbil" })
      .getByRole("button", { name: "Més" }),
  ).toHaveCount(0);
  const menu = page.getByRole("button", { name: "Menú del compte" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  const signOut = page.getByRole("menuitem", { name: "Tancar sessió" });
  await expect(signOut).toBeVisible();
  await signOut.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ca\/sign-in/);
  expect(signOutCalls).toBe(1);
});
