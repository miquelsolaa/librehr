import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// TIM-008: Settings -> Inspector access. Admins invite an auditor with an
// access end date, change it, and see the API's limit as a translated error.

const AUDITOR_ID = "22222222-2222-4222-8222-222222222222";
const DAY = 24 * 60 * 60 * 1000;

interface Captured {
  invitation?: Record<string, unknown>;
  access?: Record<string, unknown>;
}

async function mockAuditorApi(
  page: Page,
  options: { rejectInvite?: boolean } = {},
): Promise<Captured> {
  const captured: Captured = {};
  let expiresAt = new Date(Date.now() + 10 * DAY).toISOString();
  await mockRoute(page, "**/v1/settings/security", (route) =>
    route.fulfill({
      json: { requireTwoFactor: false, auditorAccessMaxDays: 90 },
    }),
  );
  await mockRoute(page, "**/v1/auditors", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            userId: AUDITOR_ID,
            name: "Sample Inspector",
            email: "inspector@example.invalid",
            accessExpiresAt: expiresAt,
          },
        ],
      },
    }),
  );
  await mockRoute(page, `**/v1/auditors/${AUDITOR_ID}/access`, (route) => {
    captured.access = route.request().postDataJSON();
    expiresAt = String(captured.access?.["accessExpiresAt"]);
    return route.fulfill({
      json: {
        userId: AUDITOR_ID,
        name: "Sample Inspector",
        email: "inspector@example.invalid",
        accessExpiresAt: expiresAt,
      },
    });
  });
  await mockRoute(page, "**/v1/invitations", (route) => {
    captured.invitation = route.request().postDataJSON();
    if (options.rejectInvite) {
      return route.fulfill({
        status: 400,
        contentType: "application/problem+json",
        json: {
          type: "about:blank",
          title: "Validation Error",
          status: 400,
          code: "AUDITOR_ACCESS_END_TOO_FAR",
          detail: "The access end date can be at most 90 days ahead",
        },
      });
    }
    return route.fulfill({
      status: 201,
      json: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "new-inspector@example.invalid",
        role: "auditor",
        expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
        accessExpiresAt: captured.invitation?.["accessExpiresAt"],
        acceptedAt: null,
        createdAt: new Date().toISOString(),
      },
    });
  });
  return captured;
}

/** `YYYY-MM-DD` of the browser's local day `offset` days from today. */
const localDate = (page: Page, offset: number) =>
  page.evaluate((days) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, offset);

test.beforeEach(async ({ page }) => {
  await seedProfile(page, { role: "admin" });
});

test("invites an auditor with an end date and extends their access", async ({
  page,
}) => {
  const captured = await mockAuditorApi(page);
  await page.goto("/en/settings/auditors");
  await expect(
    page.getByRole("heading", { name: "Inspector access" }),
  ).toBeVisible();
  await expect(page.getByText("Sample Inspector")).toBeVisible();
  await expect(page.getByText("10 days left")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page
    .getByLabel("Email", { exact: true })
    .fill("new-inspector@example.invalid");
  await page.getByLabel("Access ends on").fill(await localDate(page, 30));
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  expect(captured.invitation).toMatchObject({
    email: "new-inspector@example.invalid",
    role: "auditor",
  });
  const invitedEnd = new Date(String(captured.invitation?.["accessExpiresAt"]));
  expect(invitedEnd.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

  await page
    .getByRole("button", { name: "Change end date: Sample Inspector" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Access ends on").fill(await localDate(page, 60));
  await dialog.getByRole("button", { name: "Save end date" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Access end date updated.")).toBeVisible();
  expect(Object.keys(captured.access ?? {})).toEqual(["accessExpiresAt"]);
  await expect(page.getByText(/6[01] days left/)).toBeVisible();
});

test("shows the translated limit error when the end date is beyond the maximum", async ({
  page,
}) => {
  const captured = await mockAuditorApi(page, { rejectInvite: true });
  await page.goto("/ca/settings/auditors");
  await page.getByLabel("Correu electrònic").fill("inspector@example.invalid");
  await page.getByLabel("L’accés acaba el").fill(await localDate(page, 120));
  await page.getByRole("button", { name: "Enviar la invitació" }).click();
  await expect(page.locator("#auditor-invite-error")).toHaveText(
    "La data de fi supera el màxim de 90 dies.",
  );
  await expect(page.getByLabel("L’accés acaba el")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(captured.invitation?.["role"]).toBe("auditor");
});
