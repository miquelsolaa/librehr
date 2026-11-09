import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env["CI"];
// Overridable so parallel checkouts can each run the suite against their own
// build instead of silently reusing another server on :3000.
const port = process.env["PLAYWRIGHT_WEB_PORT"] ?? "3000";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: "list",
  use: {
    baseURL: process.env["PLAYWRIGHT_TEST_BASE_URL"] ?? baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "Desktop Chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 640 } },
    },
  ],
  webServer: {
    command: `pnpm exec next start --port ${port}`,
    cwd: "..",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120 * 1000,
  },
});
