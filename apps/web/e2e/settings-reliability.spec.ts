import { test, expect } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

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

for (const [screen, endpoint] of [
  ["departments", "**/v1/org/departments"],
  ["locations", "**/v1/org/locations"],
  ["custom-fields", "**/v1/custom-fields"],
] as const) {
  test(`${screen} distinguishes loading failure from an empty list and retries`, async ({
    page,
  }) => {
    let fail = true;
    await mockRoute(page, endpoint, async (route) => {
      if (fail) {
        fail = false;
        return route.fulfill({ status: 503 });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(`/en/settings/${screen}`);
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("Could not load this information.");
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(alert).toHaveCount(0);
  });
}

test("failed department creation retains the entered name", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/org/departments", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 503 });
    return route.fulfill({ json: [] });
  });
  await page.goto("/en/settings/departments");
  await page.getByRole("button", { name: "Add Department" }).click();
  await page.locator("#dept-name").fill("Example Team");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Could not save this change.",
  );
  await expect(page.locator("#dept-name")).toHaveValue("Example Team");
});

test("department coverage must be explicitly set and saved", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111";
  let saved: number | undefined;
  await mockRoute(page, "**/v1/org/departments**", async (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON().minPresencePercent;
      return route.fulfill({
        json: { minPresencePercent: saved },
      });
    }
    return route.fulfill({
      json: [
        {
          id,
          organizationId: id,
          name: "Operations",
          parentId: null,
          leadEmployeeId: null,
          minPresencePercent: saved ?? null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
  });
  await page.goto("/en/settings/departments");
  await expect(page.getByText("Coverage not configured")).toBeVisible();
  await page.getByLabel("Minimum presence (%)").fill("0");
  await page.getByRole("button", { name: "Save coverage" }).click();
  await expect.poll(() => saved).toBe(0);
  await expect(page.getByText("Coverage not configured")).toHaveCount(0);
});
