import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// TIM-008: Settings -> Inspector access. Admins invite an auditor with the
// last day of access (in the organization's time zone, sent as a date),
// change it, revoke it, and see the API's limit as a translated error.

const AUDITOR_ID = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-10";

interface MockState {
  invitation?: Record<string, unknown>;
  access?: Record<string, unknown>;
  accessUntil: string;
  revoked: boolean;
}

async function mockAuditorApi(
  page: Page,
  options: { rejectInvite?: boolean } = {},
): Promise<MockState> {
  const state: MockState = { accessUntil: "2026-11-19", revoked: false };
  const auditor = () => ({
    userId: AUDITOR_ID,
    name: "Sample Inspector",
    email: "inspector@example.invalid",
    accessExpiresAt: state.revoked
      ? "2026-01-01T00:00:00.000Z"
      : "2099-01-01T00:00:00.000Z",
    accessUntil: state.revoked ? "2026-01-01" : state.accessUntil,
  });
  await mockRoute(page, "**/v1/auditors", (route) =>
    route.fulfill({
      json: {
        items: [auditor()],
        pendingInvitations: [],
        timeZone: "Europe/Madrid",
        today: TODAY,
        latestAccessUntil: "2027-02-08",
        auditorAccessMaxDays: 90,
      },
    }),
  );
  await mockRoute(page, `**/v1/auditors/${AUDITOR_ID}/access`, (route) => {
    state.access = route.request().postDataJSON();
    if (state.access?.["revoke"] === true) state.revoked = true;
    else state.accessUntil = String(state.access?.["accessUntil"]);
    return route.fulfill({ json: auditor() });
  });
  await mockRoute(page, "**/v1/invitations", (route) => {
    state.invitation = route.request().postDataJSON();
    if (options.rejectInvite) {
      return route.fulfill({
        status: 400,
        contentType: "application/problem+json",
        json: {
          type: "about:blank",
          title: "Validation Error",
          status: 400,
          code: "AUDITOR_ACCESS_END_TOO_FAR",
          detail: "The last day of access can be at most 90 days ahead",
        },
      });
    }
    return route.fulfill({
      status: 201,
      json: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "new-inspector@example.invalid",
        role: "auditor",
        expiresAt: "2026-11-17T12:00:00.000Z",
        accessExpiresAt: "2026-12-10T23:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-11-10T12:00:00.000Z",
      },
    });
  });
  return state;
}

test.beforeEach(async ({ page }) => {
  await seedProfile(page, { role: "admin" });
});

test("invites an auditor and extends their access, returning focus", async ({
  page,
}) => {
  const state = await mockAuditorApi(page);
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
  await page.getByLabel("Access ends on").fill("2026-12-10");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  expect(state.invitation).toEqual({
    email: "new-inspector@example.invalid",
    role: "auditor",
    accessUntil: "2026-12-10",
  });

  const trigger = page.getByRole("button", {
    name: "Change end date: Sample Inspector",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Access ends on").fill("2027-01-08");
  await dialog.getByRole("button", { name: "Save end date" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Access end date updated.")).toBeVisible();
  expect(state.access).toEqual({ accessUntil: "2027-01-08" });
  await expect(page.getByText("60 days left")).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("revokes access after confirmation and moves focus to the list", async ({
  page,
}) => {
  const state = await mockAuditorApi(page);
  await page.goto("/en/settings/auditors");
  await page
    .getByRole("button", { name: "Revoke access: Sample Inspector" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Revoke inspector access?");
  await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText("Access revoked.")).toBeVisible();
  expect(state.access).toEqual({ revoke: true });
  await expect(page.getByText("Access ended")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revoke access: Sample Inspector" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Inspectors", exact: true }),
  ).toBeFocused();
});

test("shows the translated limit error on the date field", async ({ page }) => {
  const state = await mockAuditorApi(page, { rejectInvite: true });
  await page.goto("/ca/settings/auditors");
  await page.getByLabel("Correu electrònic").fill("inspector@example.invalid");
  await page.getByLabel("L’accés acaba el").fill("2027-03-10");
  await page.getByRole("button", { name: "Enviar la invitació" }).click();
  await expect(page.locator("#auditor-end-date-error")).toHaveText(
    "La data de fi supera el màxim de 90 dies.",
  );
  await expect(page.getByLabel("L’accés acaba el")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Correu electrònic")).not.toHaveAttribute(
    "aria-invalid",
  );
  expect(state.invitation?.["accessUntil"]).toBe("2027-03-10");
});

test("marks only the email field when the email is invalid", async ({
  page,
}) => {
  await mockAuditorApi(page);
  await page.goto("/en/settings/auditors");
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page.getByLabel("Access ends on").fill("2026-12-10");
  await page.getByRole("button", { name: "Send invitation" }).click();
  const email = page.getByLabel("Email", { exact: true });
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAttribute(
    "aria-describedby",
    "auditor-email-error",
  );
  await expect(page.getByLabel("Access ends on")).not.toHaveAttribute(
    "aria-invalid",
  );
});

test("explains on the invite page that the invitation's access has ended", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/invitations/expired-access-token", (route) =>
    route.fulfill({
      status: 410,
      contentType: "application/problem+json",
      json: {
        type: "about:blank",
        title: "Invitation Access Expired",
        status: 410,
        code: "INVITATION_ACCESS_EXPIRED",
      },
    }),
  );
  await page.goto("/es/invite/expired-access-token");
  await expect(
    page.getByText(
      "El periodo de acceso de esta invitación ha terminado. Pide una nueva invitación.",
    ),
  ).toBeVisible();
});
