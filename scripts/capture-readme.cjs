// Captures the real UI with synthetic responses; it never connects to production data.
const { chromium } = require("../apps/web/node_modules/@playwright/test");
const path = require("node:path");

const base = process.env.SCREENSHOT_BASE_URL || "http://localhost:3109";
const out = path.resolve(__dirname, "../docs/images/screens");
const fs = require("node:fs");
fs.mkdirSync(out, { recursive: true });
const personId = "11111111-1111-4111-8111-111111111111";
const people = [
  {
    id: personId,
    firstName: "Alex",
    lastName: "Example",
    email: "alex@example.invalid",
    status: "active",
    jobTitle: "Operations lead",
    departmentName: "Operations",
    locationName: "Barcelona",
    managerName: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    firstName: "Sam",
    lastName: "Example",
    email: "sam@example.invalid",
    status: "active",
    jobTitle: "Designer",
    departmentName: "Product",
    locationName: "Barcelona",
    managerName: "Alex Example",
  },
];
const departments = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Operations",
    parentId: null,
    leadEmployeeId: personId,
    minPresencePercent: 50,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Product",
    parentId: null,
    leadEmployeeId: null,
    minPresencePercent: 0,
  },
];
const days = [2, 3, 4, 5, 6].map((n, i) => ({
  date: `2026-11-0${n}`,
  dayOfWeek: i + 1,
  sessions: [],
  totalWorkedMinutes: 450,
  totalBreakMinutes: 30,
  expectedHours: 8,
  overtimeMinutes: 0,
  hasAnomaly: false,
}));
const fixtures = {
  "/v1/leave/balance": {
    currentBalance: 14,
    totalAccrued: 20,
    totalUsed: 6,
    totalCarryover: 0,
  },
  "/v1/leave/requests": [
    {
      id: "request-1",
      leaveTypeName: "Vacation",
      startDate: "2026-12-14",
      endDate: "2026-12-18",
      workingDays: 5,
      status: "approved",
    },
  ],
  "/v1/leave/types": [
    {
      id: "type-1",
      name: "Vacation",
      code: "vacation",
      isPaid: true,
      requiresApproval: true,
    },
  ],
  "/v1/leave/blackouts": [],
  "/v1/leave/delegations": [],
  "/v1/time/current-status": { status: "clocked_out", lastEvent: null },
  "/v1/time/timesheet": {
    days,
    totalWorkedMinutes: 2250,
    totalBreakMinutes: 150,
    totalExpectedHours: 40,
    totalOvertimeMinutes: 0,
  },
  "/v1/time/time-bank": {
    currentBalanceHoursFormatted: "2h 30m",
    totalAccruedMinutes: 150,
    totalCompensatedMinutes: 0,
  },
  "/v1/employees": {
    items: people,
    total: people.length,
    page: 1,
    pageSize: 100,
  },
  "/v1/org/departments": departments,
  "/v1/org/locations": [],
  "/v1/org/legal-entities": [],
  "/v1/people/org-chart": { roots: [], totalEmployees: 0 },
  "/v1/calendar/team-absences": [],
  "/v1/calendar/holidays": [],
  "/v1/documents": [],
  "/v1/documents/templates": [],
  "/v1/checklists/instances": [],
  "/v1/checklists/templates": [],
  "/v1/me": {
    id: personId,
    userId: personId,
    name: "Alex Example",
    email: "alex@example.invalid",
    role: "admin",
    organizationId: "sample",
  },
  "/v1/sso/config": null,
  "/v1/invitations/sample-invitation": {
    email: "new.person@example.invalid",
    role: "employee",
    orgName: "Example organization",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
};
const captures = [
  ["home", "/en/home"],
  ["people", "/en/people"],
  ["profile", `/en/people/${personId}`],
  ["org-chart", "/en/people/org-chart"],
  ["time-off", "/en/time-off"],
  ["leave-request", "/en/time-off/request"],
  ["calendar", "/en/time-off/calendar"],
  ["time", "/en/time"],
  ["time-corrections", "/en/time/corrections"],
  ["time-export", "/en/time/export"],
  ["shifts", "/en/time/shifts"],
  ["documents", "/en/documents"],
  ["onboarding", "/en/onboarding"],
  ["reports", "/en/reports"],
  ["settings", "/en/settings"],
  ["settings-departments", "/en/settings/departments"],
  ["settings-locations", "/en/settings/locations"],
  ["settings-time", "/en/settings/time"],
  ["settings-custom-fields", "/en/settings/custom-fields"],
  ["settings-security", "/en/settings/security"],
  ["settings-sso", "/en/settings/sso"],
  ["settings-tokens", "/en/settings/tokens"],
  ["settings-webhooks", "/en/settings/webhooks"],
  ["kiosk", "/en/kiosk"],
  ["setup", "/en/setup"],
  ["sign-in", "/en/sign-in"],
  ["invitation", "/en/invite/sample-invitation"],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      locale: "en",
    });
    await context.addInitScript(() =>
      localStorage.setItem(
        "librehr_auth_session",
        JSON.stringify({
          userId: "sample",
          organizationId: "sample",
          name: "Alex Example",
          email: "alex@example.invalid",
          role: "admin",
          token: "sample",
        }),
      ),
    );
    await context.route("**/v1/**", async (route) => {
      const req = route.request();
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
      };
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      const pathname = new URL(req.url()).pathname;
      if (pathname.startsWith("/v1/reports/"))
        return route.fulfill({
          status: 503,
          headers,
          json: { code: "REPORTS_UNAVAILABLE" },
        });
      let json = fixtures[pathname];
      if (pathname === `/v1/employees/${personId}`)
        json = {
          ...people[0],
          organizationId: "sample",
          userId: "sample",
          preferredName: null,
          phone: null,
          address: null,
          departmentId: departments[0].id,
          locationId: null,
          managerId: null,
          birthDate: null,
          terminationDate: null,
          terminationReason: null,
          hasNationalId: false,
          hasIban: false,
          employmentType: "full_time",
          startDate: "2024-02-01",
        };
      if (json === undefined) json = [];
      return route.fulfill({ status: 200, headers, json });
    });
    const page = await context.newPage();
    for (const [name, route] of captures) {
      await page.goto(base + route, { waitUntil: "networkidle" });
      const heading = page
        .locator(
          name === "kiosk"
            ? 'label[for="kiosk-id"]'
            : "main h1, main h2, h1, h2",
        )
        .first();
      await heading.waitFor({ state: "visible", timeout: 5000 });
      if (name !== "sign-in" && page.url().includes("/sign-in"))
        throw new Error(`${name} unexpectedly redirected to sign-in`);
      if (
        await page
          .locator('main [role="status"]')
          .filter({ hasText: /loading/i })
          .count()
      )
        throw new Error(`${name} remains loading`);
      if (/\bNaN\b/.test(await page.locator("body").innerText()))
        throw new Error(`${name} contains invalid numeric output`);
      await page.screenshot({
        path: path.join(out, `${name}.png`),
        fullPage: true,
        animations: "disabled",
      });
      process.stdout.write(`${name}: ${await heading.innerText()}\n`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
