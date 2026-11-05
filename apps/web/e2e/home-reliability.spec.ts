import { test, expect } from "@playwright/test";

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
