import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

// ORG-007 (issue #81): headcount by membership and org chart dotted lines.
const LEAD_ID = "00000000-0000-4000-8000-000000000091";
const MEMBER_ID = "00000000-0000-4000-8000-000000000092";
const PROJECT_ID = "00000000-0000-4000-8000-000000000093";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const headcount = {
  startingHeadcount: 2,
  endingHeadcount: 2,
  joinersCount: 0,
  leaversCount: 0,
  netChange: 0,
  turnoverRatePercent: 0,
};

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

async function requestBreakdown(page: import("@playwright/test").Page) {
  await page.goto("/en/reports");
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-06-30");
  await page
    .getByRole("combobox", { name: "Breakdown" })
    .selectOption({ label: "By project and area" });
  await page.getByRole("button", { name: "Show headcount" }).click();
}

test("shows headcount and FTE per project and area", async ({ page }) => {
  const queries: URLSearchParams[] = [];
  await mockRoute(page, "**/v1/reports/headcount?**", (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({
      json: {
        periodStart: "2026-01-01",
        periodEnd: "2026-06-30",
        headcount,
        breakdown: {
          groupBy: "group",
          basis: "membership",
          asOf: "2026-06-30",
          totalsOverlap: true,
          rows: [
            {
              type: "project",
              id: PROJECT_ID,
              name: "Launch",
              headcount: 2,
              fte: 1.4,
            },
          ],
        },
      },
    });
  });
  await requestBreakdown(page);

  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Launch/ })).toContainText(
    "Project",
  );
  await expect(table).toContainText("1.4");
  await expect(
    page.getByText("One person can count in several rows"),
  ).toBeVisible();
  expect(queries.at(-1)?.get("groupBy")).toBe("group");
  expect(queries.at(-1)?.get("basis")).toBe("membership");

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("shows no breakdown when the report cannot be loaded", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/reports/headcount?**", (route) =>
    route.fulfill({ status: 400 }),
  );
  await requestBreakdown(page);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be loaded",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("draws secondary memberships as dotted lines to their leads", async ({
  page,
}) => {
  const node = (
    id: string,
    name: string,
    managerId: string | null,
    secondaryMemberships: unknown[],
    directReports: unknown[],
  ) => ({
    id,
    name,
    preferredName: null,
    email: `${name.split(" ")[0]!.toLowerCase()}@example.invalid`,
    jobTitle: null,
    departmentId: null,
    departmentName: null,
    locationName: null,
    managerId,
    secondaryMemberships,
    directReportsCount: directReports.length,
    totalTeamCount: directReports.length,
    directReports,
  });
  const member = node(
    MEMBER_ID,
    "Alex Example",
    null,
    [
      {
        type: "project",
        id: PROJECT_ID,
        name: "Launch",
        allocationPercent: 40,
        leadEmployeeId: LEAD_ID,
        leadName: "Sam Example",
      },
    ],
    [],
  );
  await mockRoute(page, "**/v1/people/org-chart", (route) =>
    route.fulfill({
      json: {
        // Two roots: the dotted line is not a reporting line.
        roots: [node(LEAD_ID, "Sam Example", null, [], []), member],
        totalEmployees: 2,
      },
    }),
  );
  await page.goto("/en/people/org-chart");

  const dotted = page.getByRole("list", { name: "Dotted-line memberships" });
  await expect(dotted).toContainText("Launch (40%)");
  await expect(
    dotted.getByRole("link", { name: "Lead: Sam Example" }),
  ).toHaveAttribute("href", `/en/people/${LEAD_ID}`);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
});
