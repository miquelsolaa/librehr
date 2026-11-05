import { expect, test } from "@playwright/test";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
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

test("document loading failures are recoverable and never shown as an empty folder", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/v1/documents*", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, headers: cors });
    }
    return route.fulfill({ headers: cors, json: [] });
  });
  await page.goto("/en/documents");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not load documents",
  );
  await expect(page.getByText("No documents found")).toHaveCount(0);
  await page.locator("main").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No documents found")).toBeVisible();
});

test("checklist loading failures are recoverable and never shown as empty", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/v1/checklists/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (fail && route.request().url().includes("instances")) {
      fail = false;
      return route.fulfill({ status: 503, headers: cors });
    }
    return route.fulfill({ headers: cors, json: [] });
  });
  await page.goto("/en/onboarding");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not load checklists",
  );
  await page.locator("main").getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("a failed employee import is reported and the entered CSV remains available", async ({
  page,
}) => {
  await page.route("**/v1/checklists/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ headers: cors, json: [] });
  });
  await page.route("**/v1/employees/import", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 503, headers: cors });
  });
  await page.goto("/en/onboarding");
  await page.getByRole("button", { name: "Bulk Import Employees" }).click();
  const csv = "first_name,last_name,email\nExample,Person,test@example.invalid";
  await page.locator("textarea").fill(csv);
  await page.getByRole("button", { name: "Validate CSV" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not import employees",
  );
  await expect(page.locator("textarea")).toHaveValue(csv);
});
