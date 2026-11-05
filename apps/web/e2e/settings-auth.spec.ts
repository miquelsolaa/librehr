import { test, expect } from "@playwright/test";

test("settings requests use the current signed-in session", async ({
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
        token: "sample-token",
      }),
    ),
  );
  let authorization: string | undefined;
  await page.route("**/v1/org/departments", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    authorization = route.request().headers()["authorization"];
    await route.fulfill({ headers, json: [] });
  });
  await page.goto("/en/settings/departments");
  await expect.poll(() => authorization).toBe("Bearer sample-token");
});
