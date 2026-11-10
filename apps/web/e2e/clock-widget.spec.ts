import { test, expect, type Page } from "@playwright/test";
import { mockRoute } from "./support/mock-api";

type ClockStatus = "clocked_in" | "on_break" | "clocked_out";

const statusEventType: Record<ClockStatus, string> = {
  clocked_in: "clock_in",
  on_break: "break_start",
  clocked_out: "clock_out",
};

/**
 * Signs in as an employee and serves a stateful clock API: POST /time/clock
 * moves the status the same way the real API does, so every widget on the
 * page can be checked against one source of truth.
 */
async function setUpClock(
  page: Page,
  initial: ClockStatus,
  occurredAt = "2026-11-10T08:02:00.000Z",
) {
  let status = initial;
  let since = occurredAt;
  const counts = { status: 0, clock: 0 };

  await page.addInitScript(() => {
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "sample",
        organizationId: "sample",
        email: "sample@example.invalid",
        role: "employee",
      }),
    );
  });
  await mockRoute(page, "**/v1/time/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/current-status")) {
      counts.status += 1;
      return route.fulfill({
        json: {
          status,
          lastEvent:
            status === "clocked_out" && initial === "clocked_out"
              ? null
              : {
                  id: "00000000-0000-4000-8000-000000000001",
                  employeeId: "00000000-0000-4000-8000-000000000002",
                  eventType: statusEventType[status],
                  occurredAt: since,
                  recordedAt: since,
                  source: "web",
                  actorId: "00000000-0000-4000-8000-000000000003",
                  refEventId: null,
                  reason: null,
                  prevHash: null,
                  hash: "sample",
                },
        },
      });
    }
    if (path.endsWith("/clock")) {
      counts.clock += 1;
      const body = route.request().postDataJSON() as { eventType: string };
      status =
        body.eventType === "clock_in" || body.eventType === "break_end"
          ? "clocked_in"
          : body.eventType === "break_start"
            ? "on_break"
            : "clocked_out";
      since = new Date().toISOString();
      return route.fulfill({ json: {} });
    }
    // Timesheet, time bank and the rest are not under test here.
    return route.fulfill({ status: 503, json: {} });
  });
  return counts;
}

test("clocking in on Home leaves no stale Clock In control anywhere", async ({
  page,
}) => {
  const counts = await setUpClock(page, "clocked_out");
  await page.goto("/en/home");

  await page
    .getByRole("main")
    .getByRole("button", { name: "Clock In" })
    .click();

  await expect(
    page.getByRole("main").getByRole("button", { name: "Clock Out" }),
  ).toBeVisible();
  // One clock state for the whole page: nothing may still offer Clock In.
  await expect(page.getByRole("button", { name: "Clock In" })).toHaveCount(0);
  expect(counts.clock).toBe(1);
});

test("the clock status is loaded once per page, not once per widget", async ({
  page,
}) => {
  const counts = await setUpClock(page, "clocked_out");
  await page.goto("/en/time");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Clock In" }),
  ).toBeVisible();
  expect(counts.status).toBe(1);
});

test("shows since when and for how long the employee has been working", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-10T10:16:00.000Z"));
  await setUpClock(page, "clocked_in", "2026-11-10T08:02:00.000Z");
  await page.goto("/en/home");

  const main = page.getByRole("main");
  const since = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date("2026-11-10T08:02:00.000Z"));
  await expect(main.getByText(`Working since ${since}`)).toBeVisible();
  await expect(main.getByText("2 h 14 min")).toBeVisible();
  await expect(main.getByRole("button", { name: "Start Break" })).toBeVisible();
  // Ending a shift is not destructive; it must not look like a delete.
  const clockOut = main.getByRole("button", { name: "Clock Out" });
  await expect(clockOut).toBeVisible();
  await expect(clockOut).not.toHaveClass(/bg-danger/);
});

test("on a break, the only way forward is to end the break", async ({
  page,
}) => {
  await setUpClock(page, "on_break");
  await page.goto("/en/home");

  const main = page.getByRole("main");
  await expect(main.getByText(/^On break since /)).toBeVisible();
  await expect(main.getByRole("button", { name: "End Break" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Clock Out" })).toHaveCount(0);
});

test("the top bar shows the clock on other pages but not where the page has one", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 640,
    "The top-bar clock is hidden below the sm breakpoint",
  );
  await setUpClock(page, "clocked_out");

  await page.goto("/en/documents");
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Clock In" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByText("Not clocked in"),
  ).toBeVisible();

  await page.goto("/en/home");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Clock In" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Clock In" }),
  ).toHaveCount(0);
});
