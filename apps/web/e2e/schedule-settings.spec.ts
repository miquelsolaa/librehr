import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
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
test("an administrator assigns an explicitly configured seven-day schedule", async ({
  page,
}) => {
  const employeeId = "11111111-1111-4111-8111-111111111111";
  let payload:
    { rules: Array<{ expectedHours: number }>; employeeId: string } | undefined;
  await page.route("**/v1/employees**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      headers,
      json: {
        items: [
          {
            id: employeeId,
            firstName: "Example",
            lastName: "Person",
            email: "sample@example.invalid",
            status: "active",
          },
        ],
        total: 1,
      },
    });
  });
  await page.route("**/v1/schedules/assignments", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 201, headers, json: { id: employeeId } });
  });
  await page.goto("/en/settings/time");
  await page.getByLabel("Employee", { exact: true }).selectOption(employeeId);
  await page.getByLabel("Schedule name").fill("Part-time");
  await page.getByLabel("Effective from").fill("2026-01-01");
  await page.getByLabel("Minimum daily rest (hours)").fill("12");
  for (const day of [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]) {
    await page.getByLabel(`${day} hours`).fill(day === "Monday" ? "6" : "0");
    await page.getByLabel(`${day} break (minutes)`).fill("0");
  }
  await page.getByRole("button", { name: "Assign schedule" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Schedule assigned" }),
  ).toBeVisible();
  expect(payload?.employeeId).toBe(employeeId);
  expect(payload?.rules).toHaveLength(7);
  expect(payload?.rules[0]?.expectedHours).toBe(6);
});

test("schedule failures retain entered values and remain accessible", async ({
  page,
}) => {
  const employeeId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/v1/employees**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      headers,
      json: {
        items: [
          {
            id: employeeId,
            firstName: "Example",
            lastName: "Person",
            email: "sample@example.invalid",
            status: "active",
          },
        ],
        total: 1,
      },
    });
  });
  await page.route("**/v1/schedules/assignments", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      status: 409,
      headers,
      json: { code: "SCHEDULE_OVERLAP", status: 409, title: "Conflict" },
    });
  });
  await page.goto("/en/settings/time");
  await page.getByLabel("Employee", { exact: true }).selectOption(employeeId);
  await page.getByLabel("Schedule name").fill("Part-time");
  await page.getByLabel("Effective from").fill("2026-01-01");
  await page.getByLabel("Minimum daily rest (hours)").fill("12");
  for (const day of [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]) {
    await page.getByLabel(`${day} hours`).fill("0");
    await page.getByLabel(`${day} break (minutes)`).fill("0");
  }
  await page.getByRole("button", { name: "Assign schedule" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "already has a schedule",
  );
  await expect(page.getByLabel("Schedule name")).toHaveValue("Part-time");
});

test("schedule configuration is accessible with keyboard and axe", async ({
  page,
}) => {
  await page.route("**/v1/employees**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({ headers, json: { items: [], total: 0 } });
  });
  await page.goto("/en/settings/time");
  await expect(
    page.getByRole("heading", { name: "Work schedules" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
