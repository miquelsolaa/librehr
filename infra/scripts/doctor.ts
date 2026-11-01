interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

async function runDoctor(): Promise<void> {
  process.stdout.write("Running OpenHR Environment & Health Doctor...\n\n");
  const checks: DoctorCheck[] = [];

  // 1. Node.js version check
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0] ?? "0", 10);
  if (major >= 22) {
    checks.push({
      name: "Node.js Version",
      status: "pass",
      message: `${nodeVersion} (meets requirement >= 22.0.0)`,
    });
  } else {
    checks.push({
      name: "Node.js Version",
      status: "fail",
      message: `${nodeVersion} is below required >= 22.0.0`,
    });
  }

  // 2. Secret and Environment checks
  const authSecret = process.env["AUTH_SECRET"];
  if (authSecret && authSecret.length >= 32) {
    checks.push({
      name: "AUTH_SECRET",
      status: "pass",
      message: "Configured with adequate length (>= 32 chars)",
    });
  } else {
    checks.push({
      name: "AUTH_SECRET",
      status: "warn",
      message:
        "AUTH_SECRET is unset or under 32 chars (required for production auth encryption)",
    });
  }

  // 3. Database Connectivity & RLS Policy Check
  const dbUrl =
    process.env["DATABASE_URL"] ??
    "postgres://openhr:openhr_dev_password@localhost:5432/openhr";
  try {
    const postgresModule =
      (await import("../../packages/db/node_modules/postgres/cjs/src/index.js").catch(
        () => null,
      )) as {
        default?: (
          url: string,
          opts?: unknown,
        ) => {
          (query: TemplateStringsArray): Promise<[{ server_version: string }]>;
          end: (opts?: unknown) => Promise<void>;
        };
      } | null;
    if (!postgresModule?.default) {
      checks.push({
        name: "PostgreSQL Database",
        status: "warn",
        message: `Database driver not initialized in root workspace. Run 'pnpm db:migrate' to test DB.`,
      });
    } else {
      const sql = postgresModule.default(dbUrl, {
        max: 1,
        connect_timeout: 2,
        idle_timeout: 1,
      });
      try {
        const [pgVer] = await sql`SHOW server_version;`;
        checks.push({
          name: "PostgreSQL Connection",
          status: "pass",
          message: `Connected to PostgreSQL (${pgVer.server_version})`,
        });
      } catch {
        checks.push({
          name: "PostgreSQL Database",
          status: "warn",
          message: `Database offline at ${dbUrl} (run 'pnpm infra:up' to launch local dev Postgres)`,
        });
      } finally {
        await sql.end({ timeout: 1 }).catch(() => {});
      }
    }
  } catch {
    checks.push({
      name: "PostgreSQL Database",
      status: "warn",
      message: `Database offline at ${dbUrl} (run 'pnpm infra:up' to launch local dev Postgres)`,
    });
  }

  // 4. Print Summary
  let hasFailures = false;
  for (const c of checks) {
    const symbol =
      c.status === "pass" ? "[OK]" : c.status === "warn" ? "[WARN]" : "[FAIL]";
    process.stdout.write(`${symbol.padEnd(8)} ${c.name}: ${c.message}\n`);
    if (c.status === "fail") {
      hasFailures = true;
    }
  }

  process.stdout.write("\n");
  if (hasFailures) {
    process.stdout.write(
      "Doctor found critical configuration issues. Please fix them above.\n",
    );
    process.exit(1);
  } else {
    process.stdout.write("Doctor check completed successfully.\n");
  }
}

void runDoctor();
