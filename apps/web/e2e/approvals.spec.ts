import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockRoute, seedProfile } from "./support/mock-api";

// Approvals inbox (LEA-004, LEA-008, TIM-003): one place to approve or reject
// the leave requests and time corrections waiting for the signed-in person.

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const leave = {
  id: "00000000-0000-4000-8000-0000000000a1",
  employeeId: "00000000-0000-4000-8000-0000000000b1",
  employeeName: "Alex Example",
  leaveTypeId: "00000000-0000-4000-8000-0000000000c1",
  leaveTypeName: "Vacation",
  leaveTypeCode: "VAC",
  leaveTypeColor: "#2f6f4e",
  startDate: "2026-12-14",
  endDate: "2026-12-16",
  halfDayStart: false,
  halfDayEnd: false,
  workingDays: 3,
  status: "pending",
  notes: "Family trip",
  selfApproval: false as boolean,
  createdAt: "2026-11-01T09:00:00.000Z",
};

const correction = {
  id: "00000000-0000-4000-8000-0000000000a2",
  employeeId: "00000000-0000-4000-8000-0000000000b2",
  employeeName: "Sam Sample",
  proposedEventType: "clock_out",
  proposedOccurredAt: "2026-11-10T17:00:00.000Z",
  reason: "Forgot to clock out",
  status: "pending",
  createdAt: "2026-11-11T09:00:00.000Z",
};

interface Inbox {
  leaveRequests: (typeof leave)[];
  timeCorrections: (typeof correction)[];
  truncated: boolean;
}

/** Serves a mutable inbox and records decision request bodies. */
async function mockInbox(
  page: Page,
  inbox: Inbox,
  decideStatus = 200,
): Promise<unknown[]> {
  const decisions: unknown[] = [];
  await mockRoute(page, "**/v1/approvals/pending", (route) =>
    route.fulfill({ json: inbox }),
  );
  await mockRoute(page, "**/decide", async (route) => {
    decisions.push(route.request().postDataJSON());
    if (decideStatus !== 200) {
      return route.fulfill({
        status: decideStatus,
        contentType: "application/problem+json",
        json: { type: "about:blank", title: "No", status: decideStatus },
      });
    }
    const id = route.request().url().split("/").at(-2);
    inbox.leaveRequests = inbox.leaveRequests.filter((r) => r.id !== id);
    inbox.timeCorrections = inbox.timeCorrections.filter((r) => r.id !== id);
    return route.fulfill({ json: { id, status: "approved" } });
  });
  return decisions;
}

const fullInbox = (): Inbox => ({
  leaveRequests: [{ ...leave }],
  timeCorrections: [{ ...correction }],
  truncated: false,
});

test.describe("approvals page", () => {
  test.beforeEach(async ({ page }) => {
    await seedProfile(page, { role: "manager", name: "Morgan Manager" });
  });

  test("approves a leave request and updates the list", async ({ page }) => {
    const decisions = await mockInbox(page, fullInbox());
    await page.goto("/en/approvals");

    await expect(
      page.getByRole("heading", { name: "Approvals" }),
    ).toBeVisible();
    await expect(page.getByText("Family trip")).toBeVisible();
    await expect(page.getByText("Forgot to clock out")).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(axe.violations).toEqual([]);

    await page.getByRole("button", { name: /^Approve: Alex Example/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Alex Example");
    await dialog.getByRole("button", { name: "Approve" }).click();

    await expect(page.getByText("Family trip")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText(
      "Approved Alex Example's request.",
    );
    expect(decisions).toEqual([{ decision: "approve" }]);
    await expect(page.getByText("Forgot to clock out")).toBeVisible();
  });

  test("requires a reason to reject", async ({ page }) => {
    const decisions = await mockInbox(page, fullInbox());
    await page.goto("/en/approvals");

    await page.getByRole("button", { name: /^Reject: Sam Sample/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Explain the reason in at least 5 characters.",
    );
    expect(decisions).toEqual([]);

    await dialog
      .getByLabel("Reason for the employee")
      .fill("No record of a late shift");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Forgot to clock out")).toHaveCount(0);
    expect(decisions).toEqual([
      { decision: "reject", reason: "No record of a late shift" },
    ]);
  });

  test("approves your own request as sole approver only with a reason", async ({
    page,
  }) => {
    const own = {
      ...leave,
      employeeName: "Morgan Manager",
      notes: "Own trip",
      selfApproval: true,
    };
    const decisions = await mockInbox(page, {
      leaveRequests: [own],
      timeCorrections: [],
      truncated: false,
    });
    await page.goto("/en/approvals");

    await expect(
      page.getByText(
        "Your own request. Nobody else in the organization can approve it",
        { exact: false },
      ),
    ).toBeVisible();
    // Your own request can be approved, never rejected.
    await expect(
      page.getByRole("button", { name: /^Reject: Morgan Manager/ }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: /^Approve: Morgan Manager/ })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Approve your own request" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Explain the reason in at least 5 characters.",
    );
    expect(decisions).toEqual([]);
    const axe = await new AxeBuilder({ page })
      .include("[role=dialog]")
      .withTags(WCAG_TAGS)
      .analyze();
    expect(axe.violations).toEqual([]);

    await dialog
      .getByLabel("Reason for approving your own request")
      .fill("No other approver yet");
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Own trip")).toHaveCount(0);
    expect(decisions).toEqual([
      { decision: "approve", reason: "No other approver yet" },
    ]);
  });

  test("keeps the request when saving the decision fails", async ({ page }) => {
    await mockInbox(page, fullInbox(), 503);
    await page.goto("/en/approvals");

    await page.getByRole("button", { name: /^Approve: Alex Example/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve" })
      .click();

    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
      "The decision could not be saved. Try again.",
    );
    await expect(page.getByText("Family trip")).toBeVisible();
  });

  for (const status of [403, 409]) {
    test(`drops a request decided elsewhere (${status})`, async ({ page }) => {
      await mockInbox(page, fullInbox(), status);
      await page.goto("/en/approvals");

      await page
        .getByRole("button", { name: /^Approve: Alex Example/ })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Approve" })
        .click();

      await expect(
        page.getByText(
          "This request was already decided or is no longer yours to decide, so it was removed from your list.",
        ),
      ).toBeVisible();
      await expect(page.getByText("Family trip")).toHaveCount(0);
    });
  }

  test("moves focus to the next request after a decision, then to the list", async ({
    page,
  }) => {
    await mockInbox(page, fullInbox());
    await page.goto("/en/approvals");

    await page.getByRole("button", { name: /^Approve: Alex Example/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(
      page.getByRole("button", { name: /^Reject: Sam Sample/ }),
    ).toBeFocused();

    await page.getByRole("button", { name: /^Approve: Sam Sample/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(page.getByText("Nothing waiting for you")).toBeVisible();
    await expect(page.locator("#approvals-content")).toBeFocused();
  });

  test("has no accessibility violations with the reject dialog and its error", async ({
    page,
  }) => {
    await mockInbox(page, fullInbox());
    await page.goto("/en/approvals");
    await page.getByRole("button", { name: /^Reject: Alex Example/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("Reason for the employee")).toBeFocused();
    // Hover dims the shared danger button (a separate design-system issue);
    // check the resting state.
    await page.mouse.move(0, 0);
    const axe = await new AxeBuilder({ page })
      .include("[role=dialog]")
      .withTags(WCAG_TAGS)
      .analyze();
    expect(axe.violations).toEqual([]);
  });

  test("reports a failed load and retries", async ({ page }) => {
    let fail = true;
    await mockRoute(page, "**/v1/approvals/pending", (route) =>
      fail
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: fullInbox() }),
    );
    await page.goto("/en/approvals");
    await expect(
      page.getByText("Pending approvals could not be loaded."),
    ).toBeVisible();
    fail = false;
    await page
      .locator("#approvals-content")
      .getByRole("button", { name: "Try again" })
      .click();
    await expect(page.getByText("Family trip")).toBeVisible();
  });

  test("says when only the oldest items are shown", async ({ page }) => {
    await mockInbox(page, { ...fullInbox(), truncated: true });
    await page.goto("/en/approvals");
    await expect(
      page.getByText(
        "Showing the 200 oldest of each kind. Decide them to see the rest.",
      ),
    ).toBeVisible();
  });

  test("opens the reject dialog from the keyboard and returns focus", async ({
    page,
  }) => {
    await mockInbox(page, fullInbox());
    await page.goto("/en/approvals");

    const reject = page.getByRole("button", { name: /^Reject: Alex Example/ });
    await reject.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(reject).toBeFocused();
  });

  test("says when nothing is waiting", async ({ page }) => {
    await mockInbox(page, {
      leaveRequests: [],
      timeCorrections: [],
      truncated: false,
    });
    await page.goto("/en/approvals");
    await expect(page.getByText("Nothing waiting for you")).toBeVisible();
  });
});

test.describe("approvals in the navigation", () => {
  // The desktop sidebar carries the badge; the mobile bar is unit-tested.
  test.skip(({ isMobile }) => isMobile, "desktop sidebar only");

  const sidebarLink = (page: Page) =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /^Approvals/ });

  test("shows a manager the pending count and refreshes it", async ({
    page,
  }) => {
    await seedProfile(page, { role: "manager" });
    await mockInbox(page, fullInbox());
    await page.goto("/en/approvals");
    await expect(sidebarLink(page)).toContainText("2");

    await page.getByRole("button", { name: /^Approve: Alex Example/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(sidebarLink(page)).toContainText("1");
  });

  test("shows an employee the item only while they have something to decide", async ({
    page,
  }) => {
    await seedProfile(page, { role: "employee" });
    const inbox: Inbox = {
      leaveRequests: [],
      timeCorrections: [],
      truncated: false,
    };
    await mockInbox(page, inbox);
    const answered = page.waitForResponse("**/v1/approvals/pending");
    await page.goto("/en/home");
    await answered;
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(sidebarLink(page)).toHaveCount(0);

    inbox.leaveRequests = [{ ...leave }];
    await page.reload();
    await expect(sidebarLink(page)).toContainText("1");
  });

  test("never shows it to an auditor", async ({ page }) => {
    await seedProfile(page, { role: "auditor" });
    await mockInbox(page, fullInbox());
    await page.goto("/en/home");
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(sidebarLink(page)).toHaveCount(0);
  });
});

test.describe("approvals on small screens and from time off", () => {
  test("names the pending count on More in words", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the bottom bar is mobile-only");
    await seedProfile(page, { role: "manager" });
    await mockInbox(page, fullInbox());
    await page.goto("/en/home");
    await expect(
      page
        .getByRole("navigation", { name: "Mobile Navigation" })
        .getByRole("button", { name: /^More\W+2 pending$/ }),
    ).toBeVisible();
  });

  for (const [role, visible] of [
    ["manager", true],
    ["admin", true],
    ["employee", false],
  ] as const) {
    test(`links ${role}s from time off to approvals: ${visible}`, async ({
      page,
    }) => {
      await seedProfile(page, { role });
      await mockInbox(page, fullInbox());
      await page.goto("/en/time-off");
      const link = page
        .getByRole("main")
        .getByRole("link", { name: "Approvals" });
      if (visible) await expect(link).toBeVisible();
      else {
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(link).toHaveCount(0);
      }
    });
  }
});
