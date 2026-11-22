import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

// LEA-002 (#118): opt-in part-time proration of a leave policy.

const TYPE_ID = "00000000-0000-4000-8000-000000000051";
const POLICY = {
  id: "00000000-0000-4000-8000-000000000052",
  leaveTypeId: TYPE_ID,
  name: "Agreement days",
  annualAllowanceDays: 4,
  accrualMethod: "monthly",
  carryoverMaxDays: 0,
  carryoverExpiryMonths: 3,
  allowNegativeBalance: false,
  fullTimeHoursPerWeek: null,
  carryoverEnforced: false,
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
  await mockRoute(page, "**/v1/leave/types", (route) =>
    route.fulfill({
      json: [
        {
          id: TYPE_ID,
          name: "Agreement days",
          code: "other",
          isPaid: true,
          requiresApproval: true,
          requiresAttachment: false,
          halfDaysAllowed: true,
          countsWorkingDays: true,
          color: "#3b82f6",
        },
      ],
    }),
  );
});

test("an admin sets a policy's full-time week, with the statutory warning", async ({
  page,
}) => {
  let sent: unknown = null;
  await mockRoute(page, "**/v1/leave/policies**", async (route) => {
    if (route.request().method() === "PATCH") {
      sent = route.request().postDataJSON();
      return route.fulfill({
        json: { ...POLICY, fullTimeHoursPerWeek: 37.5 },
      });
    }
    return route.fulfill({ json: [POLICY] });
  });
  await page.goto("/en/settings/leave-policies");
  await expect(
    page.getByRole("heading", { level: 1, name: "Leave policies" }),
  ).toBeVisible();
  await expect(page.getByText("Not prorated")).toBeVisible();
  const field = page.getByLabel(
    "Full-time hours per week (part-time proration)",
  );
  await expect(field).toHaveAccessibleDescription(/ET art\. 12\.4\.d/);

  await field.fill("37.5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  expect(sent).toEqual({ fullTimeHoursPerWeek: 37.5 });
  await expect(
    page.getByText("Prorated against a 37.5-hour full-time week."),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("an admin opts a policy in to the carry-over cap, with the ET 38.3 note (#132)", async ({
  page,
}) => {
  let sent: unknown = null;
  await mockRoute(page, "**/v1/leave/policies**", async (route) => {
    if (route.request().method() === "PATCH") {
      sent = route.request().postDataJSON();
      return route.fulfill({ json: { ...POLICY, carryoverEnforced: true } });
    }
    return route.fulfill({ json: [POLICY] });
  });
  await page.goto("/en/settings/leave-policies");
  await expect(
    page.getByText("Off: the whole balance is carried over"),
  ).toBeVisible();
  const toggle = page.getByLabel(
    "Cap carry-over, forfeit the excess and expire carried days",
  );
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toHaveAccessibleDescription(/ET art\. 38\.3/);

  await toggle.check();
  await page.getByRole("button", { name: "Save carry-over rule" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  expect(sent).toEqual({ carryoverEnforced: true });
  await expect(page.getByText(/^On: up to 0 days carried over/)).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a failed carry-over save is reported and nothing changes", async ({
  page,
}) => {
  await mockRoute(page, "**/v1/leave/policies**", async (route) => {
    if (route.request().method() === "PATCH") {
      return route.fulfill({ status: 503 });
    }
    return route.fulfill({ json: [POLICY] });
  });
  await page.goto("/en/settings/leave-policies");
  await page
    .getByLabel("Cap carry-over, forfeit the excess and expire carried days")
    .check();
  await page.getByRole("button", { name: "Save carry-over rule" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be saved",
  );
  await expect(
    page.getByText("Off: the whole balance is carried over"),
  ).toBeVisible();
});

test("invalid hours are refused before saving, and a failed save is reported", async ({
  page,
}) => {
  let patches = 0;
  await mockRoute(page, "**/v1/leave/policies**", async (route) => {
    if (route.request().method() === "PATCH") {
      patches++;
      return route.fulfill({ status: 503 });
    }
    return route.fulfill({ json: [POLICY] });
  });
  await page.goto("/en/settings/leave-policies");
  const field = page.getByLabel(
    "Full-time hours per week (part-time proration)",
  );
  await field.fill("200");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "between 0.01 and 40",
  );
  expect(patches).toBe(0);

  await field.fill("40");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "could not be saved",
  );
  await expect(field).toHaveValue("40");
});
