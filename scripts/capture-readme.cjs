// Captures the README gallery from a local development stack.
//
// It signs in as the seeded development administrator and photographs every
// screen, so the pictures show the app as it really runs. The data is the
// fictional organization created by `pnpm db:seed`; never point this script
// at an instance that holds real people's data.
//
//   pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm dev
//   node scripts/capture-readme.cjs
const { chromium } = require("../apps/web/node_modules/@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

const base = process.env.SCREENSHOT_BASE_URL || "http://localhost:3000";
// The public development credentials from the README, not a secret.
const email = process.env.SCREENSHOT_EMAIL || "admin@librehr.local";
const password = process.env.SCREENSHOT_PASSWORD || "Password123!";
const out = path.resolve(__dirname, "../docs/images/screens");
fs.mkdirSync(out, { recursive: true });

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))
  throw new Error("capture-readme only runs against a local instance");

// [file name, route, button that opens an overlay (optional)]
const screens = [
  ["home", "/en/home"],
  ["people", "/en/people"],
  ["profile", null],
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
  ["settings-auditors", "/en/settings/auditors"],
  ["kiosk", "/en/kiosk"],
  ["dialog-invite", "/en/people", /invite/i],
  ["dialog-department", "/en/settings/departments", /add department/i],
  ["dialog-location", "/en/settings/locations", /add work center/i],
  ["panel-holidays", "/en/settings/locations", /holiday/i],
];
const variants = [
  { suffix: "", viewport: { width: 1440, height: 960 }, theme: "light" },
  {
    suffix: "-dark",
    viewport: { width: 1440, height: 960 },
    theme: "dark",
    only: ["home", "time", "time-off", "people", "dialog-invite"],
  },
  {
    suffix: "-phone",
    viewport: { width: 390, height: 844 },
    theme: "light",
    only: ["home", "time", "time-off", "dialog-invite", "panel-holidays"],
  },
];

async function settle(page, name) {
  await page.waitForLoadState("networkidle");
  const heading = page
    .locator(
      name === "kiosk" ? 'label[for="kiosk-id"]' : "main h1, main h2, h1, h2",
    )
    .first();
  await heading.waitFor({ state: "visible", timeout: 60000 });
  // Skeletons mark blocks that are still loading.
  await page
    .locator('[aria-busy="true"]')
    .first()
    .waitFor({ state: "detached", timeout: 15000 })
    .catch(() => {});
  const text = await page.locator("body").innerText();
  if (/\bNaN\b/.test(text)) throw new Error(`${name} shows NaN`);
  if (/Unhandled Runtime Error/.test(text))
    throw new Error(`${name} shows a runtime error`);
  return heading;
}

async function shoot(page, file, wholePage) {
  const viewport = page.viewportSize();
  if (wholePage) {
    // Grow the window to the page instead of stitching a scrolled capture,
    // so the sidebar runs the full height of the picture.
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    if (height > viewport.height)
      await page.setViewportSize({ width: viewport.width, height });
  }
  await page.screenshot({
    path: path.join(out, `${file}.png`),
    animations: "disabled",
  });
  await page.setViewportSize(viewport);
  process.stdout.write(`${file}\n`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const variant of variants) {
      const context = await browser.newContext({
        viewport: variant.viewport,
        colorScheme: variant.theme,
        deviceScaleFactor: variant.suffix === "-phone" ? 2 : 1,
        locale: "en",
      });
      await context.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        variant.theme,
      );
      const page = await context.newPage();

      // Signed out: the sign-in screen, then sign in through the form.
      await page.goto(`${base}/en/sign-in`);
      await settle(page, "sign-in");
      if (!variant.only || variant.suffix === "-dark")
        await shoot(page, `sign-in${variant.suffix}`, true);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/home/, { timeout: 60000 });

      for (const [name, route, opener] of screens) {
        if (variant.only && !variant.only.includes(name)) continue;
        if (name === "profile") {
          // The first person in the directory.
          await page.goto(`${base}/en/people`);
          await settle(page, "people");
          await page
            .locator('main a[href*="/people/"]:not([href$="org-chart"])')
            .first()
            .click();
          await page.waitForURL(/\/people\/[0-9a-f-]{36}/);
        } else {
          await page.goto(base + route);
        }
        await settle(page, name);
        if (opener) {
          await page.getByRole("button", { name: opener }).first().click();
          await page.getByRole("dialog").waitFor({ state: "visible" });
        }
        // An overlay belongs to the viewport, not to the page behind it.
        await shoot(page, `${name}${variant.suffix}`, !opener);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
