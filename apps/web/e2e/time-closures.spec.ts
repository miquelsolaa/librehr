import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// TIM-004 (#31): an admin closes an ended month and the time page shows the
// frozen totals; reopening needs a reason. The API is mocked; it remains
// the enforcement point for time.period.close.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
const CLOSED_AT = "2026-02-02T09:00:00.000Z";

const totals = {
  totalWorkedMinutes: 480,
  totalBreakMinutes: 0,
  totalExpectedHours: 8,
  totalOvertimeMinutes: 0,
};

interface MockState {
  closed: boolean;
  closeRequests: number;
  reopenRequests: number;
}

async function mockTimeApi(page: Page, state: MockState): Promise<void> {
  await mockRoute(page, "**/v1/time/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith("/current-status")) {
      return route.fulfill({
        json: { status: "clocked_out", lastEvent: null },
      });
    }
    if (path.endsWith("/time-bank")) {
      return route.fulfill({ status: 503, json: {} });
    }
    if (path.endsWith("/timesheet")) {
      return route.fulfill({
        json: {
          days: [],
          ...totals,
          totalWorkedMinutes: 960,
          ...(state.closed
            ? {
                closure: {
                  closedAt: CLOSED_AT,
                  periodStart: url.searchParams.get("startDate"),
                  periodEnd: url.searchParams.get("endDate"),
                  totals,
                  postCloseChanges: [
                    {
                      eventId: "00000000-0000-4000-8000-000000000010",
                      refEventId: null,
                      createdAt: "2026-02-03T10:00:00.000Z",
                    },
                  ],
                },
              }
            : {}),
        },
      });
    }
    if (path.endsWith("/closures/reopen")) {
      state.reopenRequests += 1;
      return route.fulfill({ status: 500, json: {} });
    }
    if (path.endsWith("/closures") && request.method() === "POST") {
      state.closeRequests += 1;
      state.closed = true;
      return route.fulfill({
        json: {
          month: "2026-01",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          results: [
            { employeeId: EMPLOYEE_ID, status: "closed", closedAt: CLOSED_AT },
          ],
        },
      });
    }
    if (path.endsWith("/closures")) {
      return route.fulfill({
        json: {
          month: url.searchParams.get("month"),
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          items: state.closed
            ? [
                {
                  employeeId: EMPLOYEE_ID,
                  employeeName: "Sample Person",
                  status: "closed",
                  at: CLOSED_AT,
                  actorId: "00000000-0000-4000-8000-000000000004",
                  totals,
                  reason: null,
                },
              ]
            : [],
        },
      });
    }
    return route.fulfill({ json: {} });
  });
}

test("admin closes the previous month and sees the frozen totals", async ({
  page,
}) => {
  const state: MockState = {
    closed: false,
    closeRequests: 0,
    reopenRequests: 0,
  };
  await seedProfile(page, { role: "admin" });
  await mockTimeApi(page, state);
  await page.goto("/en/time");

  // The month in progress cannot be closed.
  await expect(
    page.getByText("A month can be closed once it has ended."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Previous month" }).click();
  await page
    .getByRole("button", { name: /^Close .+ for all employees$/ })
    .click();

  await expect(
    page.getByRole("status").filter({ hasText: "Closed: 1." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Month closed on / }),
  ).toBeVisible();
  await expect(page.getByText("1 change recorded after closing")).toBeVisible();
  expect(state.closeRequests).toBe(1);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("reopening without a reason is blocked before reaching the API", async ({
  page,
}) => {
  const state: MockState = {
    closed: true,
    closeRequests: 0,
    reopenRequests: 0,
  };
  await seedProfile(page, { role: "admin" });
  await mockTimeApi(page, state);
  await page.goto("/en/time");
  await page.getByRole("button", { name: "Previous month" }).click();

  await page
    .getByRole("button", { name: "Reopen the month for Sample Person" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Reopen month" }).click();

  await expect(
    dialog.getByText("Enter a reason of at least 5 characters."),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Reason for reopening (required)"),
  ).toBeFocused();
  expect(state.reopenRequests).toBe(0);

  // Keyboard: Escape closes the dialog without reopening.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(state.reopenRequests).toBe(0);
});

test("employees see the closure banner but no closure controls", async ({
  page,
}) => {
  const state: MockState = {
    closed: true,
    closeRequests: 0,
    reopenRequests: 0,
  };
  await seedProfile(page, { role: "employee" });
  await mockTimeApi(page, state);
  await page.goto("/en/time");

  await expect(
    page.getByRole("heading", { name: /^Month closed on / }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Month closure" }),
  ).toHaveCount(0);
});
