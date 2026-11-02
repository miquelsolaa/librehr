const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(path.resolve(__dirname, "../apps/web/node_modules/@playwright/test"));

delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.all_proxy;
delete process.env.ALL_PROXY;
process.env.NO_PROXY = "localhost,127.0.0.1";
process.env.no_proxy = "localhost,127.0.0.1";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          console.log(`[probe] ${url} -> status ${res.statusCode}`);
          resolve(res.statusCode >= 200 && res.statusCode < 400);
        });
        req.on("error", () => resolve(false));
        req.setTimeout(5000, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function run() {
  console.log("=== Starting Next.js Production Server ===");
  const cleanEnv = { ...process.env };
  delete cleanEnv.http_proxy;
  delete cleanEnv.https_proxy;
  delete cleanEnv.HTTP_PROXY;
  delete cleanEnv.HTTPS_PROXY;
  delete cleanEnv.all_proxy;
  delete cleanEnv.ALL_PROXY;
  cleanEnv.NO_PROXY = "localhost,127.0.0.1";
  cleanEnv.no_proxy = "localhost,127.0.0.1";
  cleanEnv.NEXT_TELEMETRY_DISABLED = "1";
  cleanEnv.NODE_ENV = "production";

  const nextProcess = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "localhost"], {
    cwd: path.resolve("apps/web"),
    shell: true,
    env: cleanEnv,
    stdio: "pipe",
  });

  nextProcess.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  nextProcess.stderr.on("data", (d) => process.stderr.write(`[next-err] ${d}`));

  try {
    console.log(`Waiting for ${BASE_URL}/api/healthz...`);
    await waitForServer(`${BASE_URL}/api/healthz`);
    console.log("Next.js server is ready!");

    console.log("=== Launching Playwright Chromium ===");
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--no-proxy-server", "--proxy-bypass-list=*"],
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: "ca",
    });

    const sessionObj = {
      userId: "11111111-1111-1111-1111-111111111101",
      email: "admin@librehr.local",
      name: "Marta Soler",
      organizationId: "00000000-0000-0000-0000-000000000001",
      role: "admin",
      token: "librehr_dev_token",
    };

    const outDir = path.resolve("docs/images");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const screenshots = [
      {
        name: "dashboard-light.png",
        url: `${BASE_URL}/ca/home`,
        auth: true,
        theme: "light",
        waitSelector: "h1",
      },
      {
        name: "dashboard-dark.png",
        url: `${BASE_URL}/ca/home`,
        auth: true,
        theme: "dark",
        waitSelector: "h1",
      },
      {
        name: "people.png",
        url: `${BASE_URL}/ca/people`,
        auth: true,
        theme: "light",
        waitSelector: "table tbody tr",
      },
      {
        name: "time-off.png",
        url: `${BASE_URL}/ca/time-off`,
        auth: true,
        theme: "light",
        waitSelector: "table tbody tr",
      },
      {
        name: "kiosk.png",
        url: `${BASE_URL}/ca/kiosk`,
        auth: true,
        theme: "light",
        waitSelector: "button:has-text('Entrada'), button:has-text('Clock In'), button:has-text('Accés')",
      },
      {
        name: "setup-wizard.png",
        url: `${BASE_URL}/ca/setup`,
        auth: false,
        theme: "light",
        waitSelector: "form",
      },
      {
        name: "sign-in.png",
        url: `${BASE_URL}/ca/sign-in`,
        auth: false,
        theme: "light",
        waitSelector: "button[type='submit']",
      },
      {
        name: "org-chart.png",
        url: `${BASE_URL}/ca/people/org-chart`,
        auth: true,
        theme: "light",
        waitSelector: "h1",
      },
      {
        name: "reports.png",
        url: `${BASE_URL}/ca/reports`,
        auth: true,
        theme: "light",
        waitSelector: "h1",
      },
    ];

    for (const sc of screenshots) {
      console.log(`\nCapturing [${sc.name}] from ${sc.url}...`);

      const contextPage = await context.newPage();

      await contextPage.addInitScript(
        ({ auth, sessionObj, theme }) => {
          if (auth) {
            localStorage.setItem("librehr_session", JSON.stringify(sessionObj));
          } else {
            localStorage.removeItem("librehr_session");
          }
          localStorage.setItem("theme", theme);
          if (theme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        },
        { auth: sc.auth, sessionObj, theme: sc.theme }
      );

      await contextPage.goto(sc.url, { waitUntil: "networkidle" });

      if (sc.theme === "dark") {
        await contextPage.evaluate(() => {
          document.documentElement.classList.add("dark");
          document.documentElement.style.colorScheme = "dark";
        });
      }

      if (sc.waitSelector) {
        try {
          await contextPage.waitForSelector(sc.waitSelector, { timeout: 8000 });
        } catch {
          console.warn(`Warning: selector ${sc.waitSelector} timed out on ${sc.name}`);
        }
      }

      // Small pause to allow animations/transitions to settle
      await contextPage.waitForTimeout(1000);

      const targetPath = path.join(outDir, sc.name);
      await contextPage.screenshot({ path: targetPath, fullPage: false });
      const stats = fs.statSync(targetPath);
      console.log(`✓ Saved ${sc.name} (${stats.size} bytes)`);

      await contextPage.close();
    }

    await browser.close();
    console.log("\n=== All screenshots captured successfully! ===");
  } finally {
    console.log("Shutting down Next.js process...");
    nextProcess.kill();
    if (process.platform === "win32" && nextProcess.pid) {
      spawn("taskkill", ["/pid", String(nextProcess.pid), "/f", "/t"], { stdio: "ignore" });
    }
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
