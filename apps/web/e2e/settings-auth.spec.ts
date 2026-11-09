import { test, expect, type Page } from "@playwright/test";

// AUTH-001/002: the session lives only in the API's httpOnly cookie. The page
// never stores or sends a session token.
const cors = {
  "access-control-allow-origin": "http://localhost:3000",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

async function seedProfile(page: Page, extra: Record<string, string> = {}) {
  await page.addInitScript(
    (profile) =>
      localStorage.setItem("librehr_auth_session", JSON.stringify(profile)),
    {
      userId: "sample",
      organizationId: "sample",
      email: "sample@example.invalid",
      role: "admin",
      ...extra,
    },
  );
}

test("settings requests rely on the session cookie, never a Bearer token", async ({
  page,
}) => {
  // A profile left by an older version still holds a token: it must be
  // dropped, not sent.
  await seedProfile(page, { token: "legacy-token" });
  let authorization: string | undefined = "not-called";
  await page.route("**/v1/org/departments", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    authorization = route.request().headers()["authorization"];
    await route.fulfill({ headers: cors, json: [] });
  });
  await page.goto("/en/settings/departments");
  await expect.poll(() => authorization).toBeUndefined();
  const stored = await page.evaluate(() =>
    localStorage.getItem("librehr_auth_session"),
  );
  expect(stored).not.toContain("legacy-token");
});

test("sign-in keeps no token in storage", async ({ page }) => {
  await page.route("**/v1/auth/sign-in", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    await route.fulfill({
      headers: {
        ...cors,
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
  isMobile,
}) => {
  test.skip(isMobile, "The sign-out control lives in the desktop sidebar");
  await seedProfile(page);
  let signOutCalls = 0;
  await page.route("**/v1/auth/sign-out", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    signOutCalls++;
    await route.fulfill({ headers: cors, json: { success: true } });
  });
  await page.goto("/en/home");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/sign-in/);
  expect(signOutCalls).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("librehr_auth_session")),
  ).toBeNull();
});

test("sign-out still clears the local profile when the API fails", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The sign-out control lives in the desktop sidebar");
  await seedProfile(page);
  await page.route("**/v1/auth/sign-out", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    await route.fulfill({ status: 500, headers: cors, body: "" });
  });
  await page.goto("/en/home");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/sign-in/);
  expect(
    await page.evaluate(() => localStorage.getItem("librehr_auth_session")),
  ).toBeNull();
});
