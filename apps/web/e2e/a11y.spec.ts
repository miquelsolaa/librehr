import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { corsHeaders } from "./support/mock-api";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const visible =
  (find: (page: Page) => ReturnType<Page["getByText"]>) =>
  async (page: Page): Promise<void> => {
    await expect(find(page).first()).toBeVisible();
  };

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
const DEPARTMENT_ID = "00000000-0000-4000-8000-000000000003";
const TIMESTAMP = "2026-01-15T09:00:00.000Z";
const INVITE_TOKEN = "sample-invite-token";

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function signIn(page: Page, role = "admin"): Promise<void> {
  await page.addInitScript((sessionRole) => {
    localStorage.setItem(
      "librehr_auth_session",
      JSON.stringify({
        userId: "00000000-0000-4000-8000-000000000004",
        organizationId: "00000000-0000-4000-8000-000000000001",
        email: "sample@example.invalid",
        role: sessionRole,
        token: "sample-token",
      }),
    );
  }, role);
}

const employeeListItem = {
  id: EMPLOYEE_ID,
  firstName: "Alex",
  lastName: "Example",
  preferredName: null,
  email: "alex@example.invalid",
  status: "active",
  departmentName: "Operations",
  locationName: "Head office",
  jobTitle: "Analyst",
  managerName: null,
};

// Fictional fixtures shaped after the contracts in packages/contracts/src.
const API_FIXTURES: Record<string, unknown> = {
  "/v1/org": {
    id: ORG_ID,
    name: "Example Org",
    slug: "example-org",
    defaultLocale: "en",
    timezone: "Europe/Madrid",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  "/v1/me": {
    user: {
      id: "00000000-0000-4000-8000-000000000004",
      email: "sample@example.invalid",
      name: "Sample Admin",
      role: "admin",
      organizationId: ORG_ID,
      twoFactorEnabled: false,
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
  "/v1/notifications": { items: [], unreadCount: 0 },
  "/v1/time/current-status": { status: "clocked_out", lastEvent: null },
  "/v1/time/timesheet": {
    days: [],
    totalWorkedMinutes: 0,
    totalBreakMinutes: 0,
    totalExpectedHours: 0,
    totalOvertimeMinutes: 0,
  },
  "/v1/time/time-bank": {
    totalAccruedMinutes: 0,
    totalCompensatedMinutes: 0,
    currentBalanceMinutes: 0,
    currentBalanceHoursFormatted: "0h 00m",
    records: [],
  },
  "/v1/time/corrections": [],
  "/v1/leave/balance": {
    currentBalance: 22,
    totalAccrued: 22,
    totalUsed: 0,
    totalCarryover: 0,
    totalAdjustments: 0,
    entries: [],
  },
  "/v1/leave/requests": [],
  "/v1/leave/delegations": [],
  "/v1/leave/blackouts": [],
  "/v1/leave/types": [
    {
      id: "00000000-0000-4000-8000-000000000005",
      name: "Annual leave",
      code: "vacation",
      isPaid: true,
      requiresApproval: true,
      requiresAttachment: false,
      legalReference: null,
      description: null,
      halfDaysAllowed: true,
      countsWorkingDays: true,
      color: "#0f766e",
    },
  ],
  "/v1/calendar/team-absences": [
    {
      requestId: "00000000-0000-4000-8000-000000000006",
      employeeId: EMPLOYEE_ID,
      employeeName: "Alex Example",
      departmentId: DEPARTMENT_ID,
      departmentName: "Operations",
      startDate: "2026-01-20",
      endDate: "2026-01-22",
      halfDayStart: false,
      halfDayEnd: false,
      leaveTypeCode: "vacation",
      leaveTypeName: "Annual leave",
      status: "approved",
    },
  ],
  "/v1/employees": {
    items: [employeeListItem],
    total: 1,
    page: 1,
    pageSize: 50,
  },
  [`/v1/employees/${EMPLOYEE_ID}`]: {
    ...employeeListItem,
    organizationId: ORG_ID,
    userId: null,
    departmentId: DEPARTMENT_ID,
    managerId: null,
    locationId: null,
    phone: null,
    address: null,
    birthDate: null,
    terminationDate: null,
    terminationReason: null,
    employmentType: "indefinido",
    startDate: "2024-03-01",
    hasNationalId: true,
    hasIban: false,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  [`/v1/employees/${EMPLOYEE_ID}/employment-history`]: [],
  [`/v1/people/${EMPLOYEE_ID}/emergency-contacts`]: [
    {
      id: "00000000-0000-4000-8000-000000000007",
      organizationId: ORG_ID,
      employeeId: EMPLOYEE_ID,
      fullName: "Sam Example",
      relationship: "Sibling",
      phonePrimary: "+34 600 000 000",
      phoneSecondary: null,
      isPrimary: true,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  ],
  [`/v1/people/${EMPLOYEE_ID}/custom-fields`]: [],
  "/v1/people/org-chart": { roots: [], totalEmployees: 0 },
  "/v1/org/departments": [
    {
      id: DEPARTMENT_ID,
      organizationId: ORG_ID,
      name: "Operations",
      parentId: null,
      leadEmployeeId: null,
      minPresencePercent: 50,
      parentName: null,
      leadName: null,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  ],
  "/v1/custom-fields": [
    {
      id: "00000000-0000-4000-8000-000000000008",
      organizationId: ORG_ID,
      name: "Uniform size",
      code: "uniform_size",
      fieldType: "select",
      options: ["S", "M", "L"],
      required: true,
      visibility: "hr",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  ],
  "/v1/documents": [],
  "/v1/documents/templates": [],
  "/v1/checklists/instances": [],
  "/v1/shifts/templates": [],
  "/v1/shifts/patterns": [],
  "/v1/shifts/assignments": [],
  "/v1/shifts/swaps": [],
  "/v1/tokens": [],
  "/v1/webhooks": [],
  "/v1/sso/config": null,
  [`/v1/invitations/${INVITE_TOKEN}`]: {
    email: "new.person@example.invalid",
    role: "employee",
    orgName: "Example Org",
    expiresAt: "2026-12-31T00:00:00.000Z",
  },
};

/**
 * Serves every API call from fixtures so pages render their real, signed-in
 * content without a running API. Unknown endpoints answer 404 so a page can
 * never silently fall back to data that was not provided.
 */
async function mockApi(page: Page): Promise<void> {
  await page.route(/\/v1\//, async (route) => {
    const request = route.request();
    const headers = corsHeaders(request);
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers });
    }
    const { pathname } = new URL(request.url());
    if (request.method() === "GET" && pathname in API_FIXTURES) {
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify(API_FIXTURES[pathname]),
      });
    }
    return route.fulfill({
      status: 404,
      headers,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Not Found",
        status: 404,
      }),
    });
  });
}

interface PageCase {
  path: string;
  /** Accessible name of the heading that proves we landed on the intended page. */
  heading: string | RegExp;
  /** Heading level to match; most pages expose an h1. */
  level?: number;
  /** Optional wait for content that only renders once data has loaded. */
  ready?: (page: Page) => Promise<void>;
}

async function scanPage(page: Page, pageCase: PageCase): Promise<void> {
  await page.goto(pageCase.path);
  await expect(
    page.getByRole("heading", {
      level: pageCase.level ?? 1,
      name: pageCase.heading,
      exact: true,
    }),
  ).toBeVisible();
  await pageCase.ready?.(page);
  // Loading placeholders must be gone so the scan covers the settled page.
  await expect(page.getByText(/^loading/i)).toHaveCount(0);
  await expectNoAxeViolations(page);
}

test.describe("Accessibility & Privacy Boundary Tests", () => {
  test("home page passes axe accessibility scan", async ({ page }) => {
    await page.goto("/ca/home");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("sign-in page passes axe accessibility scan", async ({ page }) => {
    await page.goto("/ca/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("makes zero third-party network requests (strict privacy)", async ({
    page,
  }) => {
    const thirdPartyRequests: string[] = [];

    page.on("request", (req) => {
      const url = new URL(req.url());
      if (
        url.hostname !== "localhost" &&
        url.hostname !== "127.0.0.1" &&
        url.protocol !== "data:" &&
        url.protocol !== "blob:"
      ) {
        thirdPartyRequests.push(req.url());
      }
    });

    await page.goto("/ca/home");
    await page.waitForLoadState("networkidle");

    expect(thirdPartyRequests).toEqual([]);
  });
});

// Previously these were scanned signed out, which only covered the
// "sign in to continue" state. They now load the real screens with data.
const REDESIGNED_SCREENS: PageCase[] = [
  { path: "/en/time", heading: "Working Time Tracking (Registro de Jornada)" },
  { path: "/en/time-off", heading: "Time Off & Leave" },
  {
    path: "/en/people",
    heading: "People Directory",
    ready: visible((page) => page.getByText("Alex Example")),
  },
  {
    // The heading also holds the employee count badge once data loads.
    path: "/en/people/org-chart",
    heading: /^Org Chart/,
    ready: visible((page) => page.getByText("0 employees")),
  },
  { path: "/en/documents", heading: "Document Repository" },
  { path: "/en/onboarding", heading: "Employee Lifecycle & Checklists" },
  { path: "/en/reports", heading: "HR Insights & Reports" },
];

const SIGNED_IN_SCREENS: PageCase[] = [
  { path: "/en/kiosk", heading: "Shared Tablet Kiosk" },
  {
    path: `/en/people/${EMPLOYEE_ID}`,
    heading: "Alex Example",
    ready: visible((page) => page.getByText("Sam Example")),
  },
  { path: "/en/settings", heading: "Settings" },
  {
    path: "/en/settings/custom-fields",
    heading: "Custom Profile Fields",
    ready: visible((page) =>
      page.getByRole("heading", { name: "Uniform size" }),
    ),
  },
  {
    path: "/en/settings/departments",
    heading: "Departments",
    ready: visible((page) => page.getByRole("heading", { name: "Operations" })),
  },
  {
    path: "/en/settings/security",
    heading: "Security & Two-Factor Authentication (2FA)",
  },
  { path: "/en/settings/sso", heading: "Single Sign-On (SSO / OIDC)" },
  {
    path: "/en/settings/tokens",
    heading: "Personal Access Tokens",
    ready: visible((page) =>
      page.getByText("No personal access tokens generated yet."),
    ),
  },
  {
    path: "/en/settings/webhooks",
    heading: "Outbound Webhooks",
    ready: visible((page) => page.getByText("No webhooks configured yet.")),
  },
  {
    // This screen has no h1; its section heading identifies it.
    path: "/en/time/corrections",
    heading: "Timesheet Corrections",
    level: 2,
    ready: visible((page) => page.getByText("No corrections pending.")),
  },
  { path: "/en/time/export", heading: "Official Labour Inspection Export" },
  {
    path: "/en/time/shifts",
    heading: "Shift Roster & Continuous Cycles",
    ready: visible((page) => page.getByRole("cell", { name: "Alex Example" })),
  },
  {
    path: "/en/time-off/calendar",
    heading: "Team Schedule & Absences",
    ready: visible((page) => page.getByText("Alex Example")),
  },
  {
    path: "/en/time-off/request",
    heading: "New Time Off Request",
    ready: async (page) => {
      // The option list only fills once leave types have loaded.
      await expect(page.getByLabel("Leave Type")).toHaveValue(
        "00000000-0000-4000-8000-000000000005",
      );
    },
  },
];

const SIGNED_OUT_SCREENS: PageCase[] = [
  {
    path: `/en/invite/${INVITE_TOKEN}`,
    heading: "Accept Invitation",
    ready: visible((page) =>
      page.getByText("You have been invited to join Example Org on LibreHR."),
    ),
  },
  { path: "/en/setup", heading: "Welcome to LibreHR" },
];

test.describe("Signed-in screens pass axe", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await mockApi(page);
  });

  for (const pageCase of [...REDESIGNED_SCREENS, ...SIGNED_IN_SCREENS]) {
    test(`${pageCase.path} passes axe`, async ({ page }) => {
      await scanPage(page, pageCase);
    });
  }
});

test.describe("Signed-out flows pass axe", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  for (const pageCase of SIGNED_OUT_SCREENS) {
    test(`${pageCase.path} passes axe`, async ({ page }) => {
      await scanPage(page, pageCase);
    });
  }
});
