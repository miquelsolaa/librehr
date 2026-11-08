import fs from "node:fs";
import path from "node:path";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { handleEmailSend } from "./queues/email.send.js";
import { handleLeaveAccrue } from "./queues/leave.accrue.js";
import { handleTimeCloseDay } from "./queues/time.close-day.js";
import { handleRetentionEnforce } from "./queues/retention.enforce.js";
import { handleAuditVerifyChain } from "./queues/audit.verify-chain.js";

function tryLoadEnv(): void {
  if (typeof process.loadEnvFile === "function") {
    const candidates = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "../../.env"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          process.loadEnvFile(c);
          break;
        } catch {
          // ignore unparseable env file
        }
      }
    }
  }
}

tryLoadEnv();

const logger = pino({
  level: process.env["LOG_LEVEL"] || "info",
  timestamp: pino.stdTimeFunctions.isoTime,
});

async function startWorker() {
  const dbUrl =
    process.env["DATABASE_MIGRATION_URL"] ||
    process.env["DATABASE_URL"] ||
    "postgres://librehr_owner:librehr_dev_password@localhost:5432/librehr";

  logger.info({ msg: "Bootstrapping LibreHR Background Worker (pg-boss)..." });

  const boss = new PgBoss({
    connectionString: dbUrl,
    schema: "pgboss",
  });

  boss.on("error", (err: unknown) => {
    logger.error({
      msg: "pg-boss internal error",
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  });

  await boss.start();
  logger.info({ msg: "pg-boss started successfully" });

  // Ensure queues exist in pg-boss
  const queues = [
    "email.send",
    "leave.accrue",
    "time.close-day",
    "retention.enforce",
    "audit.verify-chain",
  ];
  for (const q of queues) {
    await boss.createQueue(q);
  }

  // Register queues
  await boss.work("email.send", async (jobs: unknown) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      if (!job) continue;
      logger.info({
        msg: "Processing email.send",
        jobId: (job as { id?: string }).id,
      });
      const dummyMailer = {
        sendMail: async () => {},
      };
      await handleEmailSend(
        job as unknown as Parameters<typeof handleEmailSend>[0],
        dummyMailer,
      );
    }
  });

  await boss.work("leave.accrue", async (jobs: unknown) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleLeaveAccrue(
        job as unknown as Parameters<typeof handleLeaveAccrue>[0],
      );
  });

  await boss.work("time.close-day", async (jobs: unknown) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleTimeCloseDay(
        job as unknown as Parameters<typeof handleTimeCloseDay>[0],
      );
  });

  await boss.work("retention.enforce", async (jobs: unknown) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleRetentionEnforce(
        job as unknown as Parameters<typeof handleRetentionEnforce>[0],
      );
  });

  await boss.work("audit.verify-chain", async (jobs: unknown) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleAuditVerifyChain(
        job as unknown as Parameters<typeof handleAuditVerifyChain>[0],
      );
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ msg: `Received ${signal}, gracefully stopping worker...` });
    await boss.stop({ graceful: true, timeout: 5000 });
    logger.info({ msg: "Worker stopped cleanly" });
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  startWorker().catch((err) => {
    logger.error({ msg: "Fatal worker start error", err: String(err) });
    process.exit(1);
  });
}
