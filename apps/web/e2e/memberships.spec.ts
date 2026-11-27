import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute, seedProfile, type MockRoute } from "./support/mock-api";

// ORG-007 (issue #81): managing memberships on the profile and the projects
// and areas settings page. Fictional fixtures shaped after the contracts.
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000091";
const PRIMARY_ID = "00000000-0000-4000-8000-000000000092";
const PROJECT_ID = "00000000-0000-4000-8000-000000000093";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000094";
const TIMESTAMP = "2026-01-15T09:00:00.000Z";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

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
const membership = {
  id: MEMBERSHIP_ID,
  employeeId: EMPLOYEE_ID,
  departmentId: null,
  groupId: PROJECT_ID,
  targetType: "project",
  targetName: "Launch",
  role: null,
  allocationPercent: 60,
  startDate: "2026-12-01",
  endDate: null as string | null,
  endReason: null as string | null,
  ended: false,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};
const profile = {
  id: EMPLOYEE_ID,
  organizationId: "00000000-0000-4000-8000-000000000095",
  userId: null,
  departmentId: PRIMARY_ID,
  managerId: null,
  locationId: null,
  firstName: "Alex",
  lastName: "Example",
  preferredName: null,
  email: "alex@example.invalid",
  status: "active",
  departmentName: "Operations",
  locationName: null,
  jobTitle: null,
  managerName: null,
  phone: null,
  address: null,
  birthDate: null,
  terminationDate: null,
  terminationReason: null,
  employmentType: "indefinido",
  workingHoursPerWeek: 40,
  startDate: "2024-03-01",
  hasNationalId: false,
  hasIban: false,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

/** Serves GETs from `fixtures` (404 otherwise) and writes from `onWrite`. */
async function mockApi(
  page: Page,
  fixtures: () => Record<string, unknown>,
  onWrite: (route: MockRoute, path: string) => unknown,
): Promise<void> {
  await mockRoute(page, /\/v1\//, (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== "GET") return onWrite(route, pathname);
    const data = fixtures();
    return pathname in data
      ? route.fulfill({ json: data[pathname] })
      : route.fulfill({
          status: 404,
          json: { title: "Not Found", status: 404 },
        });
  });
}

test.beforeEach(async ({ page }) => {
  await seedProfile(page, { role: "admin" });
});

test.describe("profile memberships", () => {
  let rows: (typeof membership)[];

  const fixtures = () => ({
    [`/v1/employees/${EMPLOYEE_ID}`]: profile,
    [`/v1/employees/${EMPLOYEE_ID}/employment-history`]: [],
    [`/v1/employees/${EMPLOYEE_ID}/memberships`]: rows,
    [`/v1/people/${EMPLOYEE_ID}/emergency-contacts`]: [],
    [`/v1/people/${EMPLOYEE_ID}/custom-fields`]: [],
    "/v1/org/departments": [],
    "/v1/org/groups": [project],
  });

  test.beforeEach(() => {
    rows = [];
  });

  test("adds a project membership and warns about over-allocation", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await mockApi(page, fixtures, (route) => {
      bodies.push(route.request().postDataJSON());
      rows = [membership];
      return route.fulfill({
        status: 201,
        json: {
          membership,
          overAllocation: { date: "2026-12-01", totalPercent: 120 },
        },
      });
    });

    await page.goto(`/en/people/${EMPLOYEE_ID}`);
    const section = page.getByRole("region", { name: "Other memberships" });
    await expect(section.getByText("No other memberships.")).toBeVisible();

    await section
      .getByLabel("Department, project or area")
      .selectOption(`group:${PROJECT_ID}`);
    await section.getByLabel("Allocation % (optional)").fill("60");
    await section.getByLabel("Start date").fill("2026-12-01");
    await section.getByRole("button", { name: "Add membership" }).click();

    await expect(section.getByRole("status")).toContainText("120%");
    await expect(
      section.getByRole("list", { name: "Current memberships" }),
    ).toContainText("Launch");
    expect(bodies).toEqual([
      {
        groupId: PROJECT_ID,
        role: null,
        allocationPercent: 60,
        startDate: "2026-12-01",
        endDate: null,
      },
    ]);
    await expectNoAxeViolations(page);
  });

  test("explains an overlapping membership", async ({ page }) => {
    await mockApi(page, fixtures, (route) =>
      route.fulfill({
        status: 409,
        json: {
          title: "Conflict",
          status: 409,
          code: "MEMBERSHIP_OVERLAP",
          detail: "The employee already belongs to this target in that period",
        },
      }),
    );

    await page.goto(`/en/people/${EMPLOYEE_ID}`);
    const section = page.getByRole("region", { name: "Other memberships" });
    await section
      .getByLabel("Department, project or area")
      .selectOption(`group:${PROJECT_ID}`);
    await section.getByLabel("Start date").fill("2026-12-01");
    await section.getByRole("button", { name: "Add membership" }).click();

    await expect(section.getByRole("alert")).toContainText(
      "already belongs to it in that period",
    );
    await expect(section.getByText("No other memberships.")).toBeVisible();
  });

  // Coarse reasons only: no free text that could hold special-category data.
  test("ends a membership with a coarse reason and explains a refusal", async ({
    page,
  }) => {
    rows = [membership];
    const bodies: unknown[] = [];
    let refuse = true;
    await mockApi(page, fixtures, (route) => {
      bodies.push(route.request().postDataJSON());
      if (refuse)
        return route.fulfill({
          status: 409,
          json: {
            title: "Conflict",
            status: 409,
            code: "MEMBERSHIP_ALREADY_ENDED",
            detail: "This membership has already been ended",
          },
        });
      const ended = {
        ...membership,
        endDate: "2099-12-31",
        endReason: "project_ended",
        ended: true,
      };
      rows = [ended];
      return route.fulfill({ json: ended });
    });

    await page.goto(`/en/people/${EMPLOYEE_ID}`);
    const section = page.getByRole("region", { name: "Other memberships" });
    await section
      .getByRole("button", { name: "End membership in Launch" })
      .click();
    await section.getByLabel("Last day").fill("2099-12-31");
    const reason = section.getByLabel("Reason (optional)");
    await expect(reason.locator("option")).toHaveText([
      "No reason given",
      "Project or assignment ended",
      "Reassigned",
      "Other",
    ]);
    await reason.selectOption({ label: "Project or assignment ended" });
    await section
      .getByRole("button", { name: "End membership", exact: true })
      .click();
    await expect(section.getByRole("alert")).toContainText(
      "already been ended",
    );
    await expectNoAxeViolations(page);

    refuse = false;
    await section
      .getByRole("button", { name: "End membership", exact: true })
      .click();
    const current = section.getByRole("list", { name: "Current memberships" });
    await expect(current).toContainText("Project or assignment ended");
    // An ended row's dates are history: no edit or end offered.
    await expect(current.getByRole("button")).toHaveCount(0);
    expect(bodies).toEqual([
      { endDate: "2099-12-31", reason: "project_ended" },
      { endDate: "2099-12-31", reason: "project_ended" },
    ]);
  });
});

test("creates and archives a project in settings", async ({ page }) => {
  let groups: unknown[] = [];
  const writes: { path: string; body: unknown }[] = [];
  await mockApi(
    page,
    () => ({ "/v1/org/groups": groups }),
    (route, path) => {
      writes.push({ path, body: route.request().postDataJSON() });
      groups = path.endsWith("/archive")
        ? [{ ...project, archivedAt: TIMESTAMP }]
        : [project];
      return route.fulfill({ status: 201, json: groups[0] });
    },
  );

  await page.goto("/en/settings/groups");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects and areas" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add project or area" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Launch");
  await dialog.getByRole("button", { name: "Save" }).click();

  const active = page.getByRole("list", { name: "Active projects and areas" });
  await expect(active).toContainText("Launch");
  expect(writes[0]).toEqual({
    path: "/v1/org/groups",
    body: {
      kind: "project",
      name: "Launch",
      description: null,
      parentId: null,
    },
  });
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Archive Launch" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(page.getByRole("heading", { name: "Archived" })).toBeVisible();
  await expect(active).toHaveCount(0);
  expect(writes[1]?.path).toBe(`/v1/org/groups/${PROJECT_ID}/archive`);
});

test("offers a retry when projects and areas cannot be loaded", async ({
  page,
}) => {
  let failing = true;
  await mockRoute(page, "**/v1/org/groups**", (route) =>
    failing
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: [project] }),
  );

  await page.goto("/en/settings/groups");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Projects and areas could not be loaded." });
  await expect(alert).toBeVisible();
  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("list", { name: "Active projects and areas" }),
  ).toContainText("Launch");
});
