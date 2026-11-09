import { expect, test } from "@playwright/test";
import { mockRoute } from "./support/mock-api";
test("a failed mark-all action retains the unread notification and reports the error", async ({
  page,
}) => {
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
  await mockRoute(page, "**/v1/notifications**", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 503 });
    return route.fulfill({
      json: {
        unreadCount: 1,
        items: [
          {
            id: "n1",
            title: "Sample reminder",
            body: "Please review",
            read: false,
          },
        ],
      },
    });
  });
  await page.goto("/en/home");
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not update notifications" }),
  ).toBeVisible();
  await expect(page.getByText("Sample reminder")).toBeVisible();
});
