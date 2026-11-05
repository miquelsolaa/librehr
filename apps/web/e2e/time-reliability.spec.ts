import { test, expect } from "@playwright/test";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "employee",
        token: "sample",
      }),
    );
  });
  await page.route("**/v1/time/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("current-status"))
      return route.fulfill({ status: 503, headers: cors, json: {} });
    if (path.endsWith("timesheet"))
      return route.fulfill({ status: 503, headers: cors, json: {} });
    return route.fulfill({ headers: cors, json: {} });
  });
});

test("unavailable clock status offers retry without a clock action", async ({
  page,
}) => {
  await page.goto("/en/time");
  await expect(
    page.getByRole("alert").filter({ hasText: "Clock status unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Clock Out" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clock In" })).toHaveCount(0);
});

test("failed timesheet does not pretend the period has zero hours", async ({
  page,
}) => {
  await page.goto("/en/time");
  await expect(
    page.getByText("Your timesheet could not be loaded."),
  ).toBeVisible();
  await expect(page.getByText("0h 0m")).toHaveCount(0);
});

test("failed clock action removes controls until status is checked again", async ({
  page,
}) => {
  await page.route("**/v1/time/current-status", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ headers: cors, json: { status: "clocked_out" } });
  });
  await page.route("**/v1/time/clock", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 503, headers: cors, json: {} });
  });
  await page.goto("/en/time");
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The time event could not be recorded." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Clock In" })).toHaveCount(0);
  await page
    .getByRole("alert")
    .filter({ hasText: "The time event could not be recorded." })
    .getByRole("button", { name: "Try again" })
    .click();
  await expect(page.getByRole("button", { name: "Clock In" })).toBeVisible();
});

test("missing schedule is explained instead of inventing working hours", async ({
  page,
}) => {
  await page.route("**/v1/time/timesheet**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      status: 409,
      headers: cors,
      json: {
        code: "SCHEDULE_NOT_CONFIGURED",
        title: "Schedule not configured",
        status: 409,
      },
    });
  });
  await page.goto("/en/time");
  await expect(
    page.getByText(
      "Ask an administrator to configure a schedule for every day in this period.",
    ),
  ).toBeVisible();
  await expect(page.getByText("0h 0m")).toHaveCount(0);
});

test("official export explains missing schedule without an alert dialog", async ({
  page,
}) => {
  await page.route("**/v1/time/export**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      status: 409,
      headers: cors,
      json: {
        code: "SCHEDULE_NOT_CONFIGURED",
        title: "Schedule not configured",
        status: 409,
      },
    });
  });
  await page.goto("/en/time/export");
  await page.getByRole("button", { name: "Generate Export" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "configure a schedule",
  );
});
