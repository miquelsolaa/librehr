import { expect, test } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// 00:30 on 11 March in Madrid is still 10 March in UTC. Form defaults must use
// the user's calendar day, not the UTC day from toISOString().
test.use({ timezoneId: "Europe/Madrid" });
const justAfterMidnightInMadrid = new Date("2026-03-10T23:30:00.000Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(justAfterMidnightInMadrid);
  await seedProfile(page, { role: "admin" });
});

test("time correction defaults to today's local date", async ({ page }) => {
  await mockRoute(page, "**/v1/time/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/en/time/corrections");
  await expect(page.locator("#correction-time")).toHaveValue(
    "2026-03-11T18:00",
  );
});

test("termination date defaults to today's local date", async ({ page }) => {
  await mockRoute(page, "**/v1/employees/person-local/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await mockRoute(page, "**/v1/employees/person-local", (route) =>
    route.fulfill({
      json: {
        id: "person-local",
        firstName: "Alex",
        lastName: "Example",
        status: "active",
        email: "alex@example.invalid",
      },
    }),
  );
  await mockRoute(page, "**/v1/people/person-local/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/en/people/person-local");
  await page.getByRole("button", { name: "Offboard Employee" }).click();
  await expect(page.locator("#term-date")).toHaveValue("2026-03-11");
});
