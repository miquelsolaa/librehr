import { expect, test } from "@playwright/test";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, OPTIONS",
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
});

test("an empty org chart stays empty and uses the signed-in session", async ({
  page,
}) => {
  await page.route("**/v1/people/org-chart", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    expect(route.request().headers()["authorization"]).toBe("Bearer sample");
    return route.fulfill({
      headers: cors,
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
  await page.route("**/v1/employees**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (failing) return route.fulfill({ status: 503, headers: cors });
    return route.fulfill({ headers: cors, json: { items: [], total: 0 } });
  });
  await page.route("**/v1/org/departments", async (route) =>
    route.fulfill({ headers: cors, json: [] }),
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
  await page.route("**/v1/people/org-chart", async (route) =>
    route.fulfill({ status: 503, headers: cors }),
  );
  await page.goto("/en/people/org-chart");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be loaded",
  );
  await expect(page.getByText("Marta Soler")).toHaveCount(0);
});
