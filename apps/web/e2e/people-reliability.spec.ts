import { expect, test } from "@playwright/test";
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

test("an administrator can append a period and sees errors without losing inputs", async ({
  page,
}) => {
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
  let fail = true;
  let saved = false;
  await mockRoute(
    page,
    "**/v1/employees/person-history/employment-history",
    async (route) => {
      if (route.request().method() === "POST") {
        if (fail) return route.fulfill({ status: 409 });
        saved = true;
        return route.fulfill({
          status: 201,
          json: {
            id: "00000000-0000-0000-0000-000000000099",
            jobTitle: "Engineer",
            employmentType: "permanent",
            startDate: "2025-01-01",
            endDate: null,
          },
        });
      }
      return route.fulfill({
        json: saved
          ? [
              {
                id: "00000000-0000-0000-0000-000000000099",
                jobTitle: "Engineer",
                employmentType: "permanent",
                startDate: "2025-01-01",
                endDate: null,
              },
            ]
          : [],
      });
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
  await page.goto("/en/people/person-history");
  await page.getByLabel("Job title").last().fill("Engineer");
  await page.getByLabel("Employment type").last().fill("permanent");
  await page.getByLabel("Start date").last().fill("2025-01-01");
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
    if (path.endsWith("/employment-history"))
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
