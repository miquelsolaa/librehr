import AxeBuilder from "@axe-core/playwright";
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

const ABSENCE = {
  requestId: "00000000-0000-4000-8000-000000000011",
  employeeId: "00000000-0000-4000-8000-000000000012",
  employeeName: "Sample Colleague",
  startDate: "2026-03-02",
  endDate: "2026-03-04",
  halfDayStart: false,
  halfDayEnd: false,
  leaveTypeCode: "sick",
  leaveTypeName: "Sick leave",
  status: "approved",
};

test("home lists who is away this week by name and date, never by reason", async ({
  page,
}) => {
  await seedProfile(page, { role: "employee", name: "Marta" });
  await mockRoute(page, "**/v1/calendar/team-absences**", (route) =>
    route.fulfill({
      json: [
        ABSENCE,
        {
          ...ABSENCE,
          requestId: "00000000-0000-4000-8000-000000000013",
          employeeName: "Undecided Colleague",
          status: "pending",
        },
      ],
    }),
  );
  await page.goto("/en/home");
  const away = page.getByRole("region", { name: "Away this week" });
  await expect(away).toContainText("Sample Colleague");
  await expect(away).toContainText("Mar");
  // Special-category data stays off the home page; requests not yet approved
  // are not absences.
  await expect(away).not.toContainText("Sick");
  await expect(away).not.toContainText("Undecided Colleague");
  await expect(
    away.getByRole("link", { name: "View team calendar" }),
  ).toHaveAttribute("href", "/en/time-off/calendar");
});

test("failed team absences on home can be retried and are not shown as nobody away", async ({
  page,
}) => {
  await seedProfile(page, { role: "employee", name: "Marta" });
  let fails = true;
  await mockRoute(page, "**/v1/calendar/team-absences**", async (route) => {
    if (fails) {
      fails = false;
      await route.fulfill({ status: 500, body: "error" });
    } else await route.fulfill({ json: [] });
  });
  await page.goto("/en/home");
  const away = page.getByRole("region", { name: "Away this week" });
  await expect(away.getByRole("alert")).toContainText(
    "Team absences could not be loaded.",
  );
  await expect(away).not.toContainText("Nobody is away");
  await away.getByRole("button", { name: "Try again" }).click();
  await expect(away).toContainText("Nobody is away in the next seven days.");
});

test("auditors land on the inspection view, never on a personal clock or balance", async ({
  page,
}) => {
  await seedProfile(page, { role: "auditor", name: "Sample Inspector" });
  // TIM-008: an auditor has no employee record, so personal endpoints 404.
  const personalCalls: string[] = [];
  for (const path of ["current-status", "timesheet**"]) {
    await mockRoute(page, `**/v1/time/${path}`, (route) => {
      personalCalls.push(route.request().url());
      return route.fulfill({
        status: 404,
        contentType: "application/problem+json",
        json: { status: 404, code: "EMPLOYEE_NOT_FOUND", title: "Not found" },
      });
    });
  }
  await mockRoute(page, "**/v1/leave/balance", (route) => {
    personalCalls.push(route.request().url());
    return route.fulfill({ status: 404, json: { status: 404 } });
  });

  await page.goto("/en/home");
  await expect(
    page.getByRole("heading", {
      name: "Labour Inspectorate (Inspección de Trabajo) Certified View",
    }),
  ).toBeVisible();
  await expect(
    page
      .locator("main")
      .getByRole("link", { name: "Official Labour Inspection Export" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(personalCalls).toEqual([]);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  // The personal time page is not theirs: it hands over to the export.
  await page.goto("/en/time");
  await expect(page).toHaveURL(/\/en\/time\/export$/);
});
