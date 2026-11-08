import { test, expect } from "@playwright/test";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "test",
        organizationId: "test",
        email: "test@example.invalid",
        role: "employee",
        token: "test",
      }),
    ),
  );
  await page.route("**/v1/leave/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      headers: cors,
      json: path.endsWith("/balance")
        ? {
            currentBalance: 8,
            totalAccrued: 10,
            totalUsed: 2,
            totalCarryover: 0,
            totalAdjustments: 0,
            entries: [],
          }
        : [],
    });
  });
});

test("an empty request list remains empty", async ({ page }) => {
  await page.goto("/en/time-off");
  await expect(
    page.getByRole("region", { name: "Remaining Balance" }).getByText("8 days"),
  ).toBeVisible();
  await expect(page.getByText("No leave requests found.")).toBeVisible();
});

test("a failed balance request shows an error and can be retried", async ({
  page,
}) => {
  let fails = true;
  await page.route("**/v1/leave/balance", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (fails) {
      fails = false;
      await route.fulfill({ status: 500, body: "error", headers: cors });
    } else
      await route.fulfill({
        headers: cors,
        json: {
          currentBalance: 8,
          totalAccrued: 10,
          totalUsed: 2,
          totalCarryover: 0,
          totalAdjustments: 0,
          entries: [],
        },
      });
  });
  await page.goto("/en/time-off");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "load your time off",
  );
  await page.locator("main").getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Remaining Balance" }).getByText("8 days"),
  ).toBeVisible();
});

test("balance history explains signed ledger entries", async ({ page }) => {
  await page.route("**/v1/leave/balance", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      headers: cors,
      json: {
        currentBalance: 8.5,
        totalAccrued: 10,
        totalUsed: 2,
        totalCarryover: 0,
        totalAdjustments: 0.5,
        entries: [
          {
            id: "1",
            employeeId: "1",
            entryType: "accrual",
            amount: 10,
            unit: "days",
            effectiveDate: "2026-01-01",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "2",
            employeeId: "1",
            entryType: "usage",
            amount: -2,
            unit: "days",
            effectiveDate: "2026-02-01",
            createdAt: "2026-02-01T00:00:00.000Z",
          },
          {
            id: "3",
            employeeId: "1",
            entryType: "adjustment",
            amount: 0.5,
            unit: "days",
            effectiveDate: "2026-03-01",
            createdAt: "2026-03-01T00:00:00.000Z",
            note: "Correction",
          },
        ],
      },
    });
  });
  await page.goto("/en/time-off");
  const history = page.getByRole("region", { name: "Balance history" });
  await expect(history.getByText("Accrual", { exact: true })).toBeVisible();
  await expect(history.getByText("−2 days", { exact: true })).toBeVisible();
  await expect(history.getByText("+0.5 days", { exact: true })).toBeVisible();
  await expect(history.getByText("Correction", { exact: true })).toBeVisible();
});

test("an unavailable policy endpoint is reported without hiding balances", async ({
  page,
}) => {
  await page.route("**/v1/leave/blackouts", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 503, headers: cors });
  });
  await page.goto("/en/time-off");
  await expect(
    page.getByRole("region", { name: "Remaining Balance" }).getByText("8 days"),
  ).toBeVisible();
  await expect(
    page.getByText("Some policy information could not be loaded."),
  ).toBeVisible();
  await expect(page.getByText("No blackout periods found.")).toHaveCount(0);
});

test("a cancellation failure is visible and retains the request", async ({
  page,
}) => {
  await page.route("**/v1/leave/requests", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      headers: cors,
      json: [
        {
          id: "request-1",
          leaveTypeName: "Vacation",
          startDate: "2026-12-01",
          endDate: "2026-12-02",
          workingDays: 2,
          status: "pending",
        },
      ],
    });
  });
  await page.route("**/v1/leave/requests/request-1/cancel", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 500, headers: cors });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/en/time-off");
  await page.getByRole("button", { name: "Cancel Request" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be cancelled",
  );
  await expect(page.getByText("Vacation", { exact: true })).toBeVisible();
});

test("leave submission explains a missing coverage policy and preserves dates", async ({
  page,
}) => {
  const headers = {
    ...cors,
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  await page.route("**/v1/leave/types", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      headers,
      json: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Vacation",
          isPaid: true,
          halfDaysAllowed: true,
        },
      ],
    });
  });
  await page.route("**/v1/leave/requests", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      status: 409,
      headers,
      json: {
        code: "COVERAGE_NOT_CONFIGURED",
        status: 409,
        title: "Coverage policy not configured",
      },
    });
  });
  await page.goto("/en/time-off/request");
  await expect(page.getByRole("option", { name: /Vacation/ })).toHaveCount(1);
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill("2030-11-04");
  await dates.nth(1).fill("2030-11-04");
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "configure your department's coverage policy",
  );
  await expect(dates.nth(0)).toHaveValue("2030-11-04");
});
