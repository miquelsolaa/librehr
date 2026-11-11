import { test, expect } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

test.describe("Org Structure & Self-Service E2E (Phase 1)", () => {
  test("renders organization chart view and tab switcher at /en/people/org-chart", async ({
    page,
  }) => {
    await page.goto("/en/people/org-chart");

    await expect(page.locator("h1")).toContainText("Org Chart");
    await expect(
      page.getByPlaceholder("Search by name, title, or department"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Directory", exact: true }),
    ).toBeVisible();
  });

  test("renders custom profile fields settings page at /en/settings/custom-fields", async ({
    page,
  }) => {
    await page.goto("/en/settings/custom-fields");

    await expect(page.locator("h1")).toContainText("Custom Profile Fields");
    await expect(
      page.getByRole("button", { name: "Add Custom Field" }),
    ).toBeVisible();

    // Open creation modal
    await page.getByRole("button", { name: "Add Custom Field" }).click();
    await expect(page.getByLabel("Field Name")).toBeVisible();
    await expect(page.getByLabel("Field Type")).toBeVisible();
    await expect(page.getByLabel("Visibility Scope")).toBeVisible();
  });

  test("renders emergency contacts and self-service edit on employee profile", async ({
    page,
  }) => {
    const id = "00000000-0000-0000-0000-000000000001";
    await seedProfile(page, { role: "employee" });
    // The profile only renders real API data; there is no sample fallback.
    await mockRoute(page, "**/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/v1/employees/${id}`)
        return route.fulfill({
          json: {
            id,
            firstName: "Alex",
            lastName: "Example",
            email: "alex@example.invalid",
            status: "active",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        });
      if (path === "/v1/org") return route.fulfill({ status: 404 });
      return route.fulfill({ json: [] });
    });
    await page.goto(`/en/people/${id}`);

    await expect(
      page.getByRole("heading", { name: "Emergency Contacts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Custom Profile Fields" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit Contact" }),
    ).toBeVisible();

    // Open self-service contact edit dialog
    await page.getByRole("button", { name: "Edit Contact" }).click();
    await expect(page.getByLabel("Preferred Name")).toBeVisible();
    await expect(page.getByLabel("Phone Number")).toBeVisible();
    await expect(page.getByLabel("Home Address")).toBeVisible();
  });
});
