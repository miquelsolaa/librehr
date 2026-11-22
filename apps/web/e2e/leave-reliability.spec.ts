import { test, expect } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

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
  await mockRoute(page, "**/v1/leave/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/balance")
        ? {
            currentBalance: 8,
            totalAccrued: 10,
            totalUsed: 2,
            totalCarryover: 0,
            totalAdjustments: 0,
            byType: [],
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
  await mockRoute(page, "**/v1/leave/balance", async (route) => {
    if (fails) {
      fails = false;
      await route.fulfill({ status: 500, body: "error" });
    } else
      await route.fulfill({
        json: {
          currentBalance: 8,
          totalAccrued: 10,
          totalUsed: 2,
          totalCarryover: 0,
          totalAdjustments: 0,
          byType: [],
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
  await mockRoute(page, "**/v1/leave/balance", async (route) => {
    return route.fulfill({
      json: {
        currentBalance: 8.5,
        totalAccrued: 10,
        totalUsed: 2,
        totalCarryover: 0,
        totalAdjustments: 0.5,
        byType: [],
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
  await mockRoute(page, "**/v1/leave/blackouts", async (route) => {
    return route.fulfill({ status: 503 });
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
  await mockRoute(page, "**/v1/leave/requests", async (route) => {
    return route.fulfill({
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
  await mockRoute(
    page,
    "**/v1/leave/requests/request-1/cancel",
    async (route) => {
      return route.fulfill({ status: 500 });
    },
  );
  await page.goto("/en/time-off");
  await page.getByRole("button", { name: "Cancel Request" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel Request" })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be cancelled",
  );
  await expect(page.getByText("Vacation", { exact: true })).toBeVisible();
});

test("leave submission explains a missing coverage policy and preserves dates", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/leave/types", async (route) => {
    return route.fulfill({
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
  await mockRoute(page, "**/v1/leave/requests", async (route) => {
    return route.fulfill({
      status: 409,
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

test("the balance history shows the balance after every entry", async ({
  page,
}) => {
  const entry = {
    employeeId: "00000000-0000-4000-8000-000000000002",
    unit: "days",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  await mockRoute(page, "**/v1/leave/balance", (route) =>
    route.fulfill({
      json: {
        currentBalance: 20.5,
        totalAccrued: 22,
        totalUsed: 1.5,
        totalCarryover: 0,
        totalAdjustments: 0,
        byType: [],
        entries: [
          {
            ...entry,
            id: "00000000-0000-4000-8000-000000000021",
            entryType: "accrual",
            amount: 22,
            effectiveDate: "2026-01-01",
            balanceAfter: 22,
          },
          {
            ...entry,
            id: "00000000-0000-4000-8000-000000000022",
            entryType: "usage",
            amount: -1.5,
            effectiveDate: "2026-03-10",
            balanceAfter: 20.5,
          },
        ],
      },
    }),
  );
  await page.goto("/en/time-off");
  const rows = page
    .getByRole("region", { name: "Balance history" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Balance 22");
  await expect(rows.nth(1)).toContainText("−1.5 days");
  await expect(rows.nth(1)).toContainText("Balance 20.5");
});
test("balances are shown per leave type, legacy entries as unassigned (LEA-005)", async ({
  page,
}) => {
  const VACATION = "00000000-0000-4000-8000-000000000031";
  const PERSONAL = "00000000-0000-4000-8000-000000000032";
  const totals = { totalCarryover: 0, totalAdjustments: 0 };
  const entry = {
    employeeId: "00000000-0000-4000-8000-000000000002",
    unit: "days",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  await mockRoute(page, "**/v1/leave/balance", (route) =>
    route.fulfill({
      json: {
        currentBalance: 23,
        totalAccrued: 24,
        totalUsed: 3,
        totalCarryover: 0,
        totalAdjustments: 2,
        byType: [
          {
            ...totals,
            leaveTypeId: VACATION,
            leaveTypeName: "Annual leave",
            leaveTypeCode: "vacation",
            leaveTypeColor: "#3b82f6",
            entitled: true,
            currentBalance: 19,
            totalAccrued: 22,
            totalUsed: 3,
          },
          {
            ...totals,
            leaveTypeId: PERSONAL,
            leaveTypeName: "Personal days",
            leaveTypeCode: "personal_days",
            leaveTypeColor: "#10b981",
            entitled: true,
            currentBalance: 2,
            totalAccrued: 2,
            totalUsed: 0,
          },
          {
            ...totals,
            leaveTypeId: "00000000-0000-4000-8000-000000000033",
            leaveTypeName: "Sick leave",
            leaveTypeCode: "sick_leave",
            leaveTypeColor: "#f59e0b",
            entitled: false,
            currentBalance: -3,
            totalAccrued: 0,
            totalUsed: 3,
          },
          {
            ...totals,
            leaveTypeId: null,
            leaveTypeName: null,
            leaveTypeCode: null,
            leaveTypeColor: null,
            entitled: false,
            currentBalance: 2,
            totalAccrued: 0,
            totalUsed: 0,
            totalAdjustments: 2,
          },
        ],
        entries: [
          {
            ...entry,
            id: "00000000-0000-4000-8000-000000000041",
            leaveTypeId: null,
            entryType: "adjustment",
            amount: 2,
            effectiveDate: "2025-12-31",
            balanceAfter: 2,
          },
          {
            ...entry,
            id: "00000000-0000-4000-8000-000000000042",
            leaveTypeId: VACATION,
            entryType: "accrual",
            amount: 22,
            effectiveDate: "2026-01-01",
            balanceAfter: 22,
          },
          {
            ...entry,
            id: "00000000-0000-4000-8000-000000000043",
            leaveTypeId: PERSONAL,
            entryType: "accrual",
            amount: 2,
            effectiveDate: "2026-01-01",
            balanceAfter: 2,
          },
          {
            ...entry,
            id: "00000000-0000-4000-8000-000000000044",
            leaveTypeId: VACATION,
            entryType: "usage",
            amount: -3,
            effectiveDate: "2026-02-10",
            balanceAfter: 19,
          },
        ],
      },
    }),
  );
  await page.goto("/en/time-off");
  const balances = page.getByRole("region", { name: "Remaining Balance" });
  const card = (name: string) =>
    balances
      .getByRole("heading", { level: 3, name, exact: true })
      .locator("xpath=..");
  await expect(card("Annual leave")).toContainText("19 days");
  await expect(card("Personal days")).toContainText("2 days");
  // Not an entitlement: days taken, never a negative balance.
  await expect(card("Sick leave")).toContainText("3 days taken");
  await expect(card("Unassigned")).toContainText(
    "before balances were kept per leave type",
  );

  const rows = page
    .getByRole("region", { name: "Balance history" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Unassigned");
  await expect(rows.nth(2)).toContainText("Personal days");
  await expect(rows.nth(3)).toContainText("Annual leave");
  await expect(rows.nth(3)).toContainText("Balance 19");
});
