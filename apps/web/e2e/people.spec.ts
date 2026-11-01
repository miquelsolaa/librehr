import { test, expect } from "@playwright/test";

test.describe("People Directory & Setup Flows (M1)", () => {
  test("loads the employee directory at /es/people", async ({ page }) => {
    await page.goto("/es/people");
    await expect(page.locator("h1")).toContainText(/Directorio|Equipo|People/);
    await expect(page.locator("input[placeholder*='Buscar']")).toBeVisible();
  });

  test("loads the first-run setup wizard at /es/setup", async ({ page }) => {
    await page.goto("/es/setup");
    await expect(page.locator("h1")).toContainText(/Bienvenido|Welcome/);
    await expect(page.locator("input#org-name")).toBeVisible();
    await expect(page.locator("input#admin-email")).toBeVisible();
  });

  test("loads settings departments view at /es/settings/departments", async ({
    page,
  }) => {
    await page.goto("/es/settings/departments");
    await expect(page.locator("h1")).toContainText(/Departamentos|Departments/);
    await expect(
      page.locator("button", { hasText: /Crear|Add/ }),
    ).toBeVisible();
  });
});
