import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

// ORG-007 (issue #81): directory and team calendar filters by any membership.
const DEPARTMENT_ID = "00000000-0000-4000-8000-000000000081";
const PROJECT_ID = "00000000-0000-4000-8000-000000000082";
const TIMESTAMP = "2026-01-15T09:00:00.000Z";

const department = {
  id: DEPARTMENT_ID,
  name: "Operations",
  parentId: null,
  leadEmployeeId: null,
  minPresencePercent: null,
  parentName: null,
  leadName: null,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};
const project = {
  id: PROJECT_ID,
  kind: "project",
  name: "Launch",
  description: null,
  parentId: null,
  leadEmployeeId: null,
  startsOn: null,
  endsOn: null,
  archivedAt: null,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};
const member = {
  id: "00000000-0000-4000-8000-000000000083",
  firstName: "Alex",
  lastName: "Example",
  preferredName: null,
  email: "alex@example.invalid",
  status: "active",
  departmentName: "Finance",
  locationName: null,
  jobTitle: null,
  managerName: null,
  secondaryMemberships: [
    { type: "project", id: PROJECT_ID, name: "Launch", allocationPercent: 40 },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "employee",
        token: "sample",
      }),
    ),
  );
  await mockRoute(page, "**/v1/org/departments", (route) =>
    route.fulfill({ json: [department] }),
  );
});

test("filters the directory by project and shows other memberships", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/org/groups**", (route) =>
    route.fulfill({ json: [project] }),
  );
  const queries: URLSearchParams[] = [];
  await mockRoute(page, /\/v1\/employees(\?|$)/, (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({
      json: { items: [member], total: 1, page: 1, pageSize: 20 },
    });
  });

  await page.goto("/en/people");
  await expect(
    page.getByRole("list", { name: "Other memberships" }),
  ).toContainText("Launch (40%)");

  await page
    .getByRole("combobox", { name: "All projects and areas" })
    .selectOption(PROJECT_ID);
  await expect
    .poll(() => queries.at(-1)?.get("groupId") ?? null)
    .toBe(PROJECT_ID);

  await page
    .getByRole("combobox", { name: "All Departments" })
    .selectOption(DEPARTMENT_ID);
  await page.getByRole("checkbox", { name: "Primary department only" }).check();
  await expect
    .poll(() => queries.at(-1)?.get("membership") ?? null)
    .toBe("primary");
  expect(queries.at(-1)?.get("departmentId")).toBe(DEPARTMENT_ID);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("says when project and area filters cannot be loaded", async ({
  page,
}) => {
  let failing = true;
  await mockRoute(page, "**/v1/org/groups**", (route) =>
    failing
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: [project] }),
  );
  await mockRoute(page, "**/v1/employees**", (route) =>
    route.fulfill({
      json: { items: [member], total: 1, page: 1, pageSize: 20 },
    }),
  );

  await page.goto("/en/people");
  const status = page
    .getByRole("status")
    .filter({ hasText: "Project and area filters could not be loaded." });
  await expect(status).toBeVisible();
  failing = false;
  await status.getByRole("button", { name: "Try again" }).click();
  await expect(status).toBeHidden();
  await expect(
    page
      .getByRole("combobox", { name: "All projects and areas" })
      .locator("option", { hasText: "Launch" }),
  ).toHaveCount(1);
});

test("filters the team calendar by department or project", async ({ page }) => {
  await mockRoute(page, "**/v1/org/groups**", (route) =>
    route.fulfill({ json: [project] }),
  );
  const queries: URLSearchParams[] = [];
  await mockRoute(page, "**/v1/calendar/team-absences**", (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: [] });
  });

  await page.goto("/en/time-off/calendar");
  const filter = page.getByLabel("Show absences for");
  await filter.selectOption(`group:${PROJECT_ID}`);
  await expect
    .poll(() => queries.at(-1)?.get("groupId") ?? null)
    .toBe(PROJECT_ID);
  expect(queries.at(-1)?.get("departmentId")).toBeNull();

  await filter.selectOption(`department:${DEPARTMENT_ID}`);
  await expect
    .poll(() => queries.at(-1)?.get("departmentId") ?? null)
    .toBe(DEPARTMENT_ID);
  expect(queries.at(-1)?.get("groupId")).toBeNull();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
