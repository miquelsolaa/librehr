import { expect, test } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

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

test("failed roster loading shows an error and can be retried", async ({
  page,
}) => {
  let fail = true;
  await mockRoute(page, "**/v1/shifts/**", async (route) => {
    if (fail && route.request().url().includes("assignments"))
      return route.fulfill({ status: 503 });
    return route.fulfill({ json: [] });
  });
  await mockRoute(page, "**/v1/employees**", (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.goto("/en/time/shifts");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not load shifts",
  );
  fail = false;
  await page.locator("main").getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("failed shift swap shows an error and preserves the reason", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/shifts/**", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 503 });
    return route.fulfill({ json: [] });
  });
  await mockRoute(page, "**/v1/employees**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "one",
            firstName: "Alex",
            lastName: "Example",
            email: "a@example.invalid",
            status: "active",
          },
          {
            id: "two",
            firstName: "Sam",
            lastName: "Example",
            email: "s@example.invalid",
            status: "active",
          },
        ],
        total: 2,
      },
    }),
  );
  await page.goto("/en/time/shifts");
  await page.getByRole("button", { name: "Request Shift Swap" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByPlaceholder("e.g. Personal family appointment")
    .fill("Family appointment");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Could not request the shift swap",
  );
  await expect(
    dialog.getByPlaceholder("e.g. Personal family appointment"),
  ).toHaveValue("Family appointment");
});
