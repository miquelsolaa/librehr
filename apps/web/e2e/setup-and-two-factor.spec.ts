import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000004";
const VALID_CODE = "123456";

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function fillSetupWizard(page: Page): Promise<void> {
  await page.getByLabel("Organization name").fill("Example Org");
  await page.getByLabel("Administrator full name").fill("Sample Admin");
  await page.getByLabel("Administrator email").fill("admin@example.invalid");
  await page.getByLabel("Administrator password").fill("sample-password-1");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Legal company name").fill("Example Org S.L.");
  await page.getByLabel("Company Tax ID (CIF)").fill("TEST-ID");
  await page.getByLabel("Primary work center name").fill("Head office");
  await page.getByLabel("City").fill("Example City");
  await page.getByRole("button", { name: "Next" }).click();
}

test.describe("setup wizard (AUTH-002)", () => {
  test("starts empty and asks for a new password", async ({ page }) => {
    await page.goto("/en/setup");
    const password = page.getByLabel("Administrator password");
    await expect(password).toHaveValue("");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel("Organization name")).toHaveValue("");
  });

  test("shows a sign-in path when setup was already completed", async ({
    page,
  }) => {
    let submitted: unknown;
    await mockRoute(page, "**/v1/org/setup-wizard", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        json: {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "SETUP_ALREADY_COMPLETED",
        },
      });
    });
    await page.goto("/en/setup");
    await fillSetupWizard(page);
    await page
      .getByRole("button", { name: "Finish Setup & Launch LibreHR" })
      .click();

    const heading = page.getByRole("heading", {
      name: "Setup already completed",
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    expect(submitted).toMatchObject({ orgName: "Example Org" });
    await expect(
      page.getByRole("link", { name: "Go to sign in" }),
    ).toHaveAttribute("href", "/en/sign-in");
    // The wizard and its generic failure message are gone.
    await expect(page.getByLabel("Administrator password")).toHaveCount(0);
    await expect(page.getByText("Setup could not be completed")).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.getByRole("link", { name: "Go to sign in" }).click();
    await expect(page).toHaveURL(/\/en\/sign-in/);
  });

  test("other setup failures keep the generic error", async ({ page }) => {
    await mockRoute(page, "**/v1/org/setup-wizard", (route) =>
      route.fulfill({ status: 500, json: { status: 500, title: "Error" } }),
    );
    await page.goto("/es/setup");
    await page.getByLabel("Nombre de la organización").fill("Example Org");
    await page.getByLabel("Nombre del administrador").fill("Sample Admin");
    await page.getByLabel("Correo del administrador").fill("a@example.invalid");
    await page
      .getByLabel("Contraseña del administrador")
      .fill("sample-password-1");
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.getByLabel("Razón social de la empresa").fill("Example S.L.");
    await page.getByLabel("CIF / NIF de la empresa").fill("TEST-ID");
    await page
      .getByLabel("Nombre del centro de trabajo principal")
      .fill("Oficina");
    await page.getByLabel("Ciudad").fill("Example City");
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page
      .getByRole("button", { name: "Finalizar Configuración y Lanzar LibreHR" })
      .click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "No se ha podido completar la configuración",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "La configuración ya se ha completado",
      }),
    ).toHaveCount(0);
  });
});

/** Serves the security settings page for a user with 2FA enabled. */
async function mockSecurityApi(
  page: Page,
  disable: (code: string) => { status: number; json: unknown },
): Promise<{ attempts: string[] }> {
  const attempts: string[] = [];
  await mockRoute(page, "**/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/v1/auth/2fa/disable" && request.method() === "POST") {
      const code = String(request.postDataJSON()?.code ?? "");
      attempts.push(code);
      return route.fulfill(disable(code));
    }
    if (pathname === "/v1/me")
      return route.fulfill({
        json: {
          user: {
            id: USER_ID,
            email: "sample@example.invalid",
            name: "Sample Admin",
            role: "admin",
            organizationId: ORG_ID,
            twoFactorEnabled: true,
          },
          organization: {
            id: ORG_ID,
            name: "Example Org",
            slug: "example-org",
            defaultLocale: "en",
            timezone: "Europe/Madrid",
            requireTwoFactor: false,
          },
          permissions: [],
        },
      });
    if (pathname === "/v1/notifications")
      return route.fulfill({ json: { items: [], unreadCount: 0 } });
    return route.fulfill({
      status: 404,
      json: { type: "about:blank", title: "Not Found", status: 404 },
    });
  });
  return { attempts };
}

test.describe("disable two-factor dialog (AUTH-003)", () => {
  test.beforeEach(async ({ page }) => {
    await seedProfile(page, {
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "admin",
    });
  });

  test("a wrong code shows an error; the right code disables 2FA", async ({
    page,
  }) => {
    const { attempts } = await mockSecurityApi(page, (code) =>
      code === VALID_CODE
        ? { status: 200, json: { success: true } }
        : {
            status: 401,
            json: {
              type: "about:blank",
              title: "Unauthorized",
              status: 401,
              code: "INVALID_2FA_CODE",
            },
          },
    );
    // Browser prompts are gone; fail loudly if one ever comes back.
    page.on("dialog", (dialog) => {
      throw new Error(`Unexpected native ${dialog.type()} dialog`);
    });
    await page.goto("/en/settings/security");
    await page.getByRole("button", { name: "Disable Two-Factor" }).click();

    const dialog = page.getByRole("dialog", { name: "Disable Two-Factor" });
    await expect(dialog).toBeVisible();
    const code = dialog.getByLabel("Authentication or recovery code");
    await expect(code).toBeFocused();
    await expectNoAxeViolations(page);

    await code.fill("000000");
    await dialog.getByRole("button", { name: "Disable two-factor" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "That code is not valid. Check your authenticator app and try again.",
    );
    await expect(code).toHaveAttribute("aria-invalid", "true");
    await expect(code).toHaveValue("");
    await expectNoAxeViolations(page);

    await code.fill(VALID_CODE);
    await code.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText(
      "Two-factor authentication disabled.",
    );
    await expect(
      page.getByRole("button", { name: "Enable Two-Factor" }),
    ).toBeVisible();
    expect(attempts).toEqual(["000000", VALID_CODE]);
  });

  test("a forbidden response is explained and nothing changes", async ({
    page,
  }) => {
    await mockSecurityApi(page, () => ({
      status: 403,
      json: { type: "about:blank", title: "Forbidden", status: 403 },
    }));
    await page.goto("/ca/settings/security");
    await page.getByRole("button", { name: "Desactivar Doble Factor" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Codi d'autenticació o de recuperació")
      .fill(VALID_CODE);
    await dialog
      .getByRole("button", { name: "Desactivar doble factor" })
      .click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "No tens permís per canviar l'autenticació en dos passos d'aquest compte.",
    );
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Cancel·lar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Desactivar Doble Factor" }),
    ).toBeVisible();
  });
});
