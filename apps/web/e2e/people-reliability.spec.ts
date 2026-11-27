import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

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
});

test("shows employment history and an error when it cannot be loaded", async ({
  page,
}) => {
  let failing = false;
  await mockRoute(
    page,
    "**/v1/employees/person-history/employment-history",
    (route) =>
      failing
        ? route.fulfill({ status: 503 })
        : route.fulfill({
            json: [
              {
                id: "00000000-0000-0000-0000-000000000099",
                jobTitle: "Designer",
                employmentType: "indefinido",
                workingHoursPerWeek: 40,
                startDate: "2023-01-01",
                endDate: "2024-12-31",
              },
            ],
          }),
  );
  await mockRoute(page, "**/v1/employees/person-history", (route) =>
    route.fulfill({
      json: {
        id: "person-history",
        firstName: "Alex",
        lastName: "Example",
        status: "active",
        email: "alex@example.invalid",
      },
    }),
  );
  await mockRoute(
    page,
    "**/v1/people/person-history/emergency-contacts",
    (route) => route.fulfill({ json: [] }),
  );
  await page.goto("/en/people/person-history");
  await expect(
    page.getByRole("heading", { name: "Employment history" }),
  ).toBeVisible();
  await expect(page.getByText("Designer")).toBeVisible();
  failing = true;
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Employment history could not be loaded" }),
  ).toBeVisible();
});

/** Signs in as an admin and mocks a profile whose history POSTs succeed. */
async function adminHistory(
  page: Page,
  options: { fail?: () => boolean } = {},
): Promise<{ posted: () => unknown }> {
  await page.addInitScript(() =>
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "admin",
        organizationId: "sample",
        email: "admin@example.invalid",
        role: "admin",
        token: "sample",
      }),
    ),
  );
  let saved: Record<string, unknown> | null = null;
  const period = () => ({
    id: "00000000-0000-0000-0000-000000000099",
    jobTitle: "Engineer",
    employmentType: "permanent",
    workingHoursPerWeek: 40,
    startDate: "2025-01-01",
    endDate: null,
    ...saved,
  });
  await mockRoute(
    page,
    "**/v1/employees/person-history/employment-history",
    async (route) => {
      if (route.request().method() === "POST") {
        if (options.fail?.()) return route.fulfill({ status: 409 });
        saved = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 201, json: period() });
      }
      return route.fulfill({ json: saved ? [period()] : [] });
    },
  );
  await mockRoute(page, "**/v1/employees/person-history", (route) =>
    route.fulfill({
      json: {
        id: "person-history",
        firstName: "Alex",
        lastName: "Example",
        status: "active",
        email: "alex@example.invalid",
      },
    }),
  );
  await mockRoute(
    page,
    "**/v1/people/person-history/emergency-contacts",
    (route) => route.fulfill({ json: [] }),
  );
  return { posted: () => saved };
}

test("an administrator can append a period and sees errors without losing inputs", async ({
  page,
}) => {
  let fail = true;
  const { posted } = await adminHistory(page, { fail: () => fail });
  await page.goto("/en/people/person-history");
  await page.getByLabel("Job title").last().fill("Engineer");
  await page.getByLabel("Employment type").last().fill("permanent");
  await page.getByLabel("Start date").last().fill("2025-01-01");
  // Above the 40 h maximum (ET art. 34.1): refused in the page, not sent.
  const hours = page.getByLabel("Weekly hours (optional)");
  await hours.fill("41");
  await page.getByRole("button", { name: "Add period" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "at most 40" }),
  ).toBeVisible();
  await expect(hours).toHaveAttribute("aria-invalid", "true");
  expect(posted()).toBeNull();
  await hours.fill("20.5");
  await expect(hours).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Add period" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Employment period could not be saved" }),
  ).toBeVisible();
  await expect(page.getByLabel("Job title").last()).toHaveValue("Engineer");
  fail = false;
  await page.getByRole("button", { name: "Add period" }).click();
  await expect(page.getByText("Engineer", { exact: true })).toBeVisible();
  await expect(page.getByText("20.5 h/week")).toBeVisible();
  expect(posted()).toMatchObject({ workingHoursPerWeek: 20.5 });
});

test("weekly hours accept a decimal comma in Catalan", async ({ page }) => {
  const { posted } = await adminHistory(page);
  await page.goto("/ca/people/person-history");
  await page.getByLabel("Lloc de treball").last().fill("Enginyera");
  await page.getByLabel("Tipus de contracte").last().fill("indefinit");
  await page.getByLabel("Data d'inici").last().fill("2025-01-01");
  await page.getByLabel("Hores setmanals (opcional)").fill("37,5");
  await page.getByRole("button", { name: "Afegeix període" }).click();
  await expect(page.getByText("37,5 h/setmana")).toBeVisible();
  expect(posted()).toMatchObject({ workingHoursPerWeek: 37.5 });
});

test("warns about a backdated start and stays accessible with errors shown", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-03-10T12:00:00Z"));
  await adminHistory(page);
  await page.goto("/en/people/person-history");
  const start = page.getByLabel("Start date").last();
  await start.fill("2026-03-02");
  await expect(page.getByText(/before the current month/)).toHaveCount(0);
  await start.fill("2026-02-27");
  const warning = page.getByText(/before the current month/);
  await expect(warning).toBeVisible();
  const warningId = await warning.getAttribute("id");
  await expect(start).toHaveAttribute("aria-describedby", warningId!);
  // Non-blocking, but shown next to an hours error for the axe scan.
  await page.getByLabel("Job title").last().fill("Engineer");
  await page.getByLabel("Employment type").last().fill("permanent");
  const hours = page.getByLabel("Weekly hours (optional)");
  await hours.fill("12.345");
  await page.getByRole("button", { name: "Add period" }).click();
  const error = page.getByRole("alert").filter({ hasText: "at most 40" });
  await expect(error).toBeVisible();
  await expect(hours).toHaveAttribute(
    "aria-describedby",
    new RegExp(`${await error.getAttribute("id")}$`),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("an empty org chart stays empty and uses the signed-in session", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/people/org-chart", async (route) => {
    // The session rides on the httpOnly cookie; no token reaches the page.
    expect(route.request().headers()["authorization"]).toBeUndefined();
    return route.fulfill({
      json: { roots: [], totalEmployees: 0 },
    });
  });
  await page.goto("/en/people/org-chart");
  await expect(
    page.getByText("No reporting hierarchy configured yet."),
  ).toBeVisible();
  await expect(page.getByText("Marta Soler")).toHaveCount(0);
});

test("directory reports an API failure and retries without sample people", async ({
  page,
}) => {
  let failing = true;
  await mockRoute(page, "**/v1/employees**", async (route) => {
    if (failing) return route.fulfill({ status: 503 });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await mockRoute(page, "**/v1/org/departments", async (route) =>
    route.fulfill({ json: [] }),
  );
  // ORG-007: the project and area filter has its own retry; keep it loaded.
  await mockRoute(page, "**/v1/org/groups**", async (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/en/people");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be loaded",
  );
  await expect(page.getByText("Marta Soler")).toHaveCount(0);
  failing = false;
  await page.locator("main").getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("org chart reports an API failure instead of sample hierarchy", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/people/org-chart", async (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/en/people/org-chart");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be loaded",
  );
  await expect(page.getByText("Marta Soler")).toHaveCount(0);
});

test("employee profile reports a failed request without showing sample data", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/employees/person-1", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/en/people/person-1");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "profile could not be loaded",
  );
  await expect(page.getByText("Joan Martí")).toHaveCount(0);
});

test("contact failure is visible while the actual employee profile remains available", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/employees/person-1", (route) =>
    route.fulfill({
      json: {
        id: "person-1",
        firstName: "Alex",
        lastName: "Example",
        status: "active",
        email: "alex@example.invalid",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    }),
  );
  await mockRoute(
    page,
    "**/v1/employees/person-1/employment-history",
    (route) => route.fulfill({ json: [] }),
  );
  await mockRoute(page, "**/v1/employees/person-1/memberships", (route) =>
    route.fulfill({ json: [] }),
  );
  await mockRoute(page, "**/v1/people/person-1/emergency-contacts", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/en/people/person-1");
  await expect(page.getByText("Alex Example").first()).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /Emergency contacts could not be loaded/,
  );
  await expect(page.getByText("Maria Martí")).toHaveCount(0);
});

test("late contacts from a previous profile do not appear on another employee", async ({
  page,
}) => {
  let releaseContacts: () => void = () => {};
  let contactsRequested: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    releaseContacts = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    contactsRequested = resolve;
  });
  const person = (id: string, firstName: string) => ({
    id,
    firstName,
    lastName: "Example",
    status: "active",
    email: `${id}@example.invalid`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await mockRoute(page, "**/v1/employees**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/employment-history") || path.endsWith("/memberships"))
      return route.fulfill({ json: [] });
    if (path.endsWith("/person-1"))
      return route.fulfill({ json: person("person-1", "Alex") });
    if (path.endsWith("/person-2"))
      return route.fulfill({
        json: person("person-2", "Robin"),
      });
    return route.fulfill({
      json: { items: [person("person-2", "Robin")], total: 1 },
    });
  });
  await mockRoute(page, "**/v1/people/*/emergency-contacts", async (route) => {
    if (route.request().url().includes("person-1")) {
      contactsRequested();
      await waiting;
      return route
        .fulfill({
          json: [
            {
              id: "old",
              fullName: "Old Contact",
              relationship: "Friend",
              phonePrimary: "123",
            },
          ],
        })
        .catch(() => {});
    }
    return route.fulfill({ json: [] });
  });
  await mockRoute(page, "**/v1/org/departments", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/en/people/person-1");
  await expect(page.getByText("Alex Example").first()).toBeVisible();
  await requested;
  await page.getByRole("link", { name: "People" }).first().click();
  await page.getByRole("link", { name: "View" }).first().click();
  await expect(page.getByText("Robin Example").first()).toBeVisible();
  releaseContacts();
  await expect(page.getByText("Old Contact")).toHaveCount(0);
});
