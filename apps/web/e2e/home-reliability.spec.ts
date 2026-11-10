import { test, expect } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

test("home does not invent employee balances or a working day when signed out", async ({
  page,
}) => {
  await page.goto("/en/home");
  await expect(page.getByText("21.0 dies")).toHaveCount(0);
  await expect(page.getByText("5h 42m")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("signed-out users do not see sample notifications", async ({ page }) => {
  await page.goto("/en/home");
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText("Sign in to view notifications")).toBeVisible();
});

const BALANCE = {
  currentBalance: 12.5,
  totalAccrued: 14,
  totalUsed: 1.5,
  totalCarryover: 0,
  totalAdjustments: 0,
  entries: [],
};

test("home leads with today and the clock, not a page of link cards", async ({
  page,
}) => {
  await seedProfile(page, { role: "employee", name: "Marta" });
  await mockRoute(page, "**/v1/leave/balance", (route) =>
    route.fulfill({ json: BALANCE }),
  );
  await page.goto("/en/home");
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat("en", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date()),
  );
  const header = page.locator("main header");
  await expect(header.getByRole("heading", { level: 1 })).toHaveText(
    "Hello, Marta",
  );
  await expect(header).toContainText(today);
  await expect(header).not.toContainText("in one place");
  await expect(
    page.locator("main").getByRole("link", { name: "View documents" }),
  ).toHaveCount(0);
});

test("home shows a skeleton while the balance loads, then the figure and a request action", async ({
  page,
}) => {
  await seedProfile(page, { role: "employee", name: "Marta" });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await mockRoute(page, "**/v1/leave/balance", async (route) => {
    await held;
    await route.fulfill({ json: BALANCE });
  });
  await page.goto("/en/home");
  const balance = page.getByRole("region", { name: "Your time off" });
  await expect(balance).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("main")).not.toContainText("Loading…");
  release();
  await expect(balance).not.toHaveAttribute("aria-busy", "true");
  await expect(balance).toContainText("12.5");
  await expect(balance).toContainText("days remaining");
  await expect(
    balance.getByRole("link", { name: "Request time off" }),
  ).toHaveAttribute("href", "/en/time-off/request");
});

test("a failed balance on home can be retried", async ({ page }) => {
  await seedProfile(page, { role: "employee", name: "Marta" });
  let fails = true;
  await mockRoute(page, "**/v1/leave/balance", async (route) => {
    if (fails) {
      fails = false;
      await route.fulfill({ status: 500, body: "error" });
    } else await route.fulfill({ json: BALANCE });
  });
  await page.goto("/en/home");
  const balance = page.getByRole("region", { name: "Your time off" });
  await expect(balance.getByRole("alert")).toContainText(
    "Your balance could not be loaded.",
  );
  await balance.getByRole("button", { name: "Try again" }).click();
  await expect(balance).toContainText("12.5");
});
