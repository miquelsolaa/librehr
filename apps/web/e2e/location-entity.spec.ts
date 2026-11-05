import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
test("first location is created using a selected real legal entity", async ({
  page,
}) => {
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
  let selected: string | undefined;
  const entityId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/v1/org/**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith("legal-entities"))
      return route.fulfill({
        headers,
        json: [{ id: entityId, name: "Example entity" }],
      });
    if (route.request().method() === "POST") {
      selected = route.request().postDataJSON().legalEntityId;
      return route.fulfill({ status: 201, headers, json: {} });
    }
    return route.fulfill({ headers, json: [] });
  });
  await page.goto("/en/settings/locations");
  await page.getByRole("button", { name: "Add Work Center" }).click();
  await expect(page.getByLabel("Legal entity", { exact: true })).toBeVisible();
  await page.getByLabel("Legal entity", { exact: true }).selectOption(entityId);
  await page.locator("#loc-name").fill("Example office");
  await page.locator("#loc-city").fill("Barcelona");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => selected).toBe(entityId);
});

test("a first legal entity can be created before its first location", async ({
  page,
}) => {
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
  await page.route("**/v1/org/**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (
      route.request().url().endsWith("legal-entities") &&
      route.request().method() === "POST"
    )
      return route.fulfill({
        status: 201,
        headers,
        json: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "New entity",
        },
      });
    return route.fulfill({ headers, json: [] });
  });
  await page.goto("/en/settings/locations");
  await page.getByRole("button", { name: "Add Work Center" }).click();
  await page.getByLabel("Legal entity name").fill("New entity");
  await page.getByLabel("Tax ID").fill("TEST-ID");
  await page.getByRole("button", { name: "Create legal entity" }).click();
  await expect(page.getByLabel("Legal entity", { exact: true })).toHaveValue(
    "11111111-1111-4111-8111-111111111111",
  );
});

test("failed legal entity creation preserves input and reports the error", async ({
  page,
}) => {
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
  await page.route("**/v1/org/**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (route.request().method() === "POST")
      return route.fulfill({ status: 500, headers });
    return route.fulfill({ headers, json: [] });
  });
  await page.goto("/en/settings/locations");
  await page.getByRole("button", { name: "Add Work Center" }).click();
  await page.getByLabel("Legal entity name").fill("New entity");
  await page.getByLabel("Tax ID").fill("TEST-ID");
  await page.getByRole("button", { name: "Create legal entity" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Could not create the legal entity",
  );
  await expect(page.getByLabel("Legal entity name")).toHaveValue("New entity");
  await expect(page.getByLabel("Tax ID")).toHaveValue("TEST-ID");
});

test("new legal entity form has no axe violations", async ({ page }) => {
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
  await page.route("**/v1/org/**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({ headers, json: [] });
  });
  await page.goto("/en/settings/locations");
  await page.getByRole("button", { name: "Add Work Center" }).click();
  await expect(page.getByLabel("Legal entity name")).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});
